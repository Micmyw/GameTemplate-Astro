import { createReadStream } from "node:fs";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

import { load } from "cheerio";

const MEBIBYTE = 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 100 * MEBIBYTE;
const DEFAULT_LARGE_ASSET_WARNING_BYTES = MEBIBYTE;
const CONTENT_SCAN_OVERLAP = 256;
const PACKAGE_ORIGIN = "https://package.invalid";
const PACKAGE_PREFIX = "/__game_package__/";

const SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);
const STYLE_EXTENSIONS = new Set([".css"]);
const HTML_EXTENSIONS = new Set([".htm", ".html"]);
const SERVER_EXTENSIONS = new Set([
  ".asp",
  ".aspx",
  ".cgi",
  ".fcgi",
  ".jsp",
  ".jspx",
  ".phar",
  ".php",
  ".php3",
  ".php4",
  ".php5",
  ".php7",
  ".php8",
  ".phtml",
  ".pl",
  ".pm",
  ".py",
  ".pyc",
  ".pyo",
  ".rb",
]);
const SECRET_EXTENSIONS = new Set([".key", ".p12", ".pem", ".pfx", ".ppk"]);
const SECRET_KEY_NAMES = new Set([
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);
const FORBIDDEN_DIRECTORY_NAMES = new Set([".git", "node_modules"]);

const toPosixPath = (value) => value.replaceAll("\\", "/");

const errorCode = (error) =>
  typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;

const isMissingError = (error) => errorCode(error) === "ENOENT";

const isInsideRoot = (root, candidate) => {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) &&
      pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`))
  );
};

const encodedPackageUrl = (relativePath) => {
  const encoded = toPosixPath(relativePath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(`${PACKAGE_PREFIX}${encoded}`, PACKAGE_ORIGIN);
};

const cssCodePoint = (hexadecimal) => {
  const codePoint = Number.parseInt(hexadecimal, 16);
  if (
    codePoint === 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return "\uFFFD";
  }
  return String.fromCodePoint(codePoint);
};

const decodeCssEscapes = (value) =>
  value
    .replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?/giu, (_, hexadecimal) =>
      cssCodePoint(hexadecimal),
    )
    .replace(/\\([^\r\n0-9a-f])/giu, "$1");

const redactMessage = (message) => message.replace(/[\r\n]+/gu, " ").trim();

const sanitizeIssuePath = (value) =>
  toPosixPath(value).replace(
    /[\u0000-\u001f\u007f-\u009f]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

const createReport = (maxFileBytes) => ({
  schemaVersion: 1,
  ok: false,
  summary: {
    fileCount: 0,
    totalBytes: 0,
    entry: "index.html",
    maxFileBytes,
  },
  errors: [],
  warnings: [],
});

const addIssue = (state, severity, code, path, message) => {
  const normalizedPath = path ? sanitizeIssuePath(path) : undefined;
  const key = `${severity}\0${code}\0${normalizedPath ?? ""}`;
  if (state.issueKeys.has(key)) return;
  state.issueKeys.add(key);

  const issue = {
    code,
    ...(normalizedPath ? { path: normalizedPath } : {}),
    message: redactMessage(message),
  };
  state.report[severity].push(issue);
};

const addError = (state, code, path, message) =>
  addIssue(state, "errors", code, path, message);

const addWarning = (state, code, path, message) =>
  addIssue(state, "warnings", code, path, message);

const issueSort = (left, right) =>
  (left.path ?? "").localeCompare(right.path ?? "") ||
  left.code.localeCompare(right.code);

const secretFileReason = (relativePath) => {
  const name = basename(relativePath).toLocaleLowerCase("en-US");
  const extension = extname(name);

  if (/^\.env(?:\..+)?$/u.test(name)) return "environment file";
  if (/^\.dev\.vars(?:\..+)?$/u.test(name)) return "Wrangler variables file";
  if (SECRET_EXTENSIONS.has(extension)) return "key or PEM container";
  if (SECRET_KEY_NAMES.has(name)) return "SSH private key filename";
  if (/private[._ -]?key/u.test(name) || /^ssh_host_.+_key$/u.test(name)) {
    return "private key filename";
  }
  return undefined;
};

const hasSecretContent = (contents) =>
  /-----BEGIN (?:[A-Z0-9][A-Z0-9 ]* )?(?:PRIVATE KEY|CERTIFICATE)-----/u.test(
    contents,
  ) || /PuTTY-User-Key-File-/u.test(contents);

const hasServerContent = (contents) =>
  /<\?php\b/iu.test(contents) ||
  /^#![^\r\n]*(?:perl\d*|php\d*|python\d*(?:\.\d+)*|ruby\d*(?:\.\d+)*)\b/imu.test(
    contents,
  );

const hasInlineSourceMap = (contents) =>
  /[#@]\s*sourceMappingURL\s*=/iu.test(contents);

const isHashedAsset = (relativePath) =>
  /(?:^|[._-])[a-f0-9]{8,}(?=[._-]|$)/iu.test(basename(relativePath));

async function scanForbiddenContent(file) {
  let tail = "";
  let secret = false;
  let server = false;
  let sourceMap = false;

  const stream = createReadStream(file, { encoding: "utf8" });
  for await (const chunk of stream) {
    const contents = `${tail}${chunk}`;
    const normalizedContents = contents.replaceAll("\0", "");
    secret ||= hasSecretContent(normalizedContents);
    server ||= hasServerContent(normalizedContents);
    sourceMap ||= hasInlineSourceMap(normalizedContents);
    if (secret && server && sourceMap) break;
    tail = contents.slice(-CONTENT_SCAN_OVERLAP);
  }

  return { secret, server, sourceMap };
}

async function walkPackage(state, directory, relativeDirectory = "") {
  let handle;
  try {
    handle = await opendir(directory);
  } catch {
    addError(
      state,
      "DIRECTORY_UNREADABLE",
      relativeDirectory,
      "A package directory could not be read.",
    );
    return;
  }

  for await (const entry of handle) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const absolutePath = join(directory, entry.name);

    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch {
      addError(
        state,
        "ENTRY_UNREADABLE",
        relativePath,
        "A package entry could not be inspected.",
      );
      continue;
    }

    if (metadata.isSymbolicLink()) {
      addError(
        state,
        "SYMLINK_NOT_ALLOWED",
        relativePath,
        "Symbolic links and junctions are not allowed in game packages.",
      );
      try {
        const target = await realpath(absolutePath);
        if (!isInsideRoot(state.rootRealPath, target)) {
          addError(
            state,
            "REALPATH_ESCAPE",
            relativePath,
            "An entry resolves outside the package root.",
          );
        }
      } catch {
        addError(
          state,
          "SYMLINK_BROKEN",
          relativePath,
          "A symbolic link target could not be resolved.",
        );
      }
      continue;
    }

    let resolvedEntry;
    try {
      resolvedEntry = await realpath(absolutePath);
    } catch {
      addError(
        state,
        "ENTRY_UNREADABLE",
        relativePath,
        "A package entry could not be resolved.",
      );
      continue;
    }

    if (!isInsideRoot(state.rootRealPath, resolvedEntry)) {
      addError(
        state,
        "REALPATH_ESCAPE",
        relativePath,
        "An entry resolves outside the package root.",
      );
      continue;
    }

    if (metadata.isDirectory()) {
      if (
        FORBIDDEN_DIRECTORY_NAMES.has(entry.name.toLocaleLowerCase("en-US"))
      ) {
        addError(
          state,
          "FORBIDDEN_DIRECTORY",
          relativePath,
          ".git and node_modules directories are not allowed.",
        );
        continue;
      }
      state.directories.add(relativePath);
      await walkPackage(state, absolutePath, relativePath);
      continue;
    }

    if (!metadata.isFile()) {
      addError(
        state,
        "UNSUPPORTED_FILE_TYPE",
        relativePath,
        "Only regular files and directories are allowed.",
      );
      continue;
    }

    if (metadata.nlink > 1) {
      addError(
        state,
        "HARD_LINK_NOT_ALLOWED",
        relativePath,
        "Files with multiple hard links are not allowed in game packages.",
      );
      continue;
    }

    state.files.push({
      absolutePath,
      relativePath,
      realPath: resolvedEntry,
      size: metadata.size,
    });
  }
}

async function verifyEntryFile(state) {
  const entryPath = join(state.rootPath, "index.html");
  let metadata;
  try {
    metadata = await lstat(entryPath);
  } catch (error) {
    addError(
      state,
      isMissingError(error) ? "ENTRY_MISSING" : "ENTRY_UNREADABLE",
      "index.html",
      isMissingError(error)
        ? "The package must contain index.html."
        : "index.html could not be inspected.",
    );
    return;
  }

  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    addError(
      state,
      "ENTRY_NOT_FILE",
      "index.html",
      "index.html must be a regular file.",
    );
  }
}

async function inspectFile(state, file) {
  const lowerPath = file.relativePath.toLocaleLowerCase("en-US");
  const extension = extname(lowerPath);
  const secretReason = secretFileReason(file.relativePath);

  if (secretReason) {
    addError(
      state,
      "SECRET_FILE",
      file.relativePath,
      `A ${secretReason} is not allowed in a game package.`,
    );
  }
  if (extension === ".map") {
    addError(
      state,
      "SOURCE_MAP",
      file.relativePath,
      "Source maps are not allowed by the default release policy.",
    );
  }
  if (SERVER_EXTENSIONS.has(extension)) {
    addError(
      state,
      "SERVER_FILE",
      file.relativePath,
      "Server-side program files are not allowed in a static game package.",
    );
  }
  if (file.size > state.options.maxFileBytes) {
    addError(
      state,
      "FILE_TOO_LARGE",
      file.relativePath,
      `The file exceeds the configured ${state.options.maxFileBytes}-byte maximum.`,
    );
    return;
  }
  if (
    (SCRIPT_EXTENSIONS.has(extension) || STYLE_EXTENSIONS.has(extension)) &&
    file.size > state.options.largeAssetWarningBytes &&
    !isHashedAsset(file.relativePath)
  ) {
    addWarning(
      state,
      "UNHASHED_LARGE_ASSET",
      file.relativePath,
      `A large JS or CSS asset is not content-hash named (threshold: ${state.options.largeAssetWarningBytes} bytes).`,
    );
  }

  let forbiddenContent;
  try {
    forbiddenContent = await scanForbiddenContent(file.absolutePath);
  } catch {
    addError(
      state,
      "FILE_UNREADABLE",
      file.relativePath,
      "A package file could not be read.",
    );
    return;
  }

  if (forbiddenContent.secret) {
    addError(
      state,
      "SECRET_CONTENT",
      file.relativePath,
      "Private key, SSH key, or PEM content is not allowed.",
    );
  }
  if (forbiddenContent.server) {
    addError(
      state,
      "SERVER_CONTENT",
      file.relativePath,
      "Server-side program content is not allowed.",
    );
  }
  if (forbiddenContent.sourceMap) {
    addError(
      state,
      "SOURCE_MAP",
      file.relativePath,
      "Inline and referenced source maps are not allowed by default.",
    );
  }

  if (
    !HTML_EXTENSIONS.has(extension) &&
    !STYLE_EXTENSIONS.has(extension) &&
    !SCRIPT_EXTENSIONS.has(extension)
  ) {
    return;
  }

  let contents;
  try {
    contents = await readFile(file.absolutePath, "utf8");
  } catch {
    addError(
      state,
      "FILE_UNREADABLE",
      file.relativePath,
      "A package text file could not be read.",
    );
    return;
  }

  if (HTML_EXTENSIONS.has(extension)) analyzeHtml(state, file, contents);
  if (STYLE_EXTENSIONS.has(extension)) {
    analyzeCss(
      state,
      file.relativePath,
      contents,
      encodedPackageUrl(file.relativePath),
    );
  }
  if (SCRIPT_EXTENSIONS.has(extension))
    analyzeScript(state, file.relativePath, contents);
}

const staticScheme = (value) => {
  const normalized = value
    .replace(/^[\u0000-\u0020]+/u, "")
    .replace(/[\u0000-\u0020]+$/u, "")
    .replace(/[\t\n\r]/gu, "");
  const match = /^([a-z][a-z0-9+.-]*):/iu.exec(normalized);
  return match?.[1]?.toLocaleLowerCase("en-US");
};

const rejectForbiddenScriptUrl = (state, sourcePath, rawValue) => {
  const scheme = staticScheme(rawValue.trim());
  if (!new Set(["blob", "data"]).has(scheme)) return false;

  addError(
    state,
    "SCRIPT_URL_NOT_ALLOWED",
    sourcePath,
    "Script URLs must not use embedded data or blob schemes.",
  );
  return true;
};

const resourceTarget = (state, sourcePath, rawValue, baseUrl, kind) => {
  const value = rawValue.trim();
  if (!value || value.startsWith("#")) return;

  const scheme = staticScheme(value);
  if (scheme === "javascript") {
    addError(
      state,
      "JAVASCRIPT_URL",
      sourcePath,
      "javascript: resource URLs are not allowed.",
    );
    return;
  }
  if (kind === "script" && rejectForbiddenScriptUrl(state, sourcePath, value))
    return;
  if (new Set(["data", "blob", "mailto", "tel"]).has(scheme)) return;
  if (scheme && !new Set(["http", "https"]).has(scheme)) {
    addError(
      state,
      "RESOURCE_PATH_ESCAPE",
      sourcePath,
      "A resource URL uses an unsupported scheme.",
    );
    return;
  }

  let url;
  try {
    url = new URL(value.replaceAll("\\", "/"), baseUrl);
  } catch {
    addError(
      state,
      "RESOURCE_URL_INVALID",
      sourcePath,
      "A resource URL is malformed.",
    );
    return;
  }

  if (url.origin !== PACKAGE_ORIGIN) {
    if (kind === "script") {
      addWarning(
        state,
        "EXTERNAL_SCRIPT",
        sourcePath,
        "A third-party absolute script URL was found.",
      );
    } else if (kind === "form") {
      addWarning(
        state,
        "EXTERNAL_FORM",
        sourcePath,
        "An external form action was found.",
      );
    } else {
      addWarning(
        state,
        "EXTERNAL_NETWORK",
        sourcePath,
        "A third-party network resource was found.",
      );
    }
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname).replaceAll("\\", "/");
  } catch {
    addError(
      state,
      "RESOURCE_URL_INVALID",
      sourcePath,
      "A resource URL contains malformed escaping.",
    );
    return;
  }

  if (!decodedPath.startsWith(PACKAGE_PREFIX)) {
    addError(
      state,
      "RESOURCE_PATH_ESCAPE",
      sourcePath,
      "A local resource path escapes the package root.",
    );
    return;
  }

  let target = decodedPath.slice(PACKAGE_PREFIX.length);
  if (target.endsWith("/")) target += "index.html";

  if (!target || target.startsWith("../") || target.includes("/../")) {
    addError(
      state,
      "RESOURCE_PATH_ESCAPE",
      sourcePath,
      "A local resource path escapes the package root.",
    );
    return;
  }

  if (!state.filePaths.has(target)) {
    addError(
      state,
      "RESOURCE_MISSING",
      sourcePath,
      "A referenced local resource does not exist as a regular file.",
    );
  }
};

const baseUrlForHtml = (state, file, $) => {
  const sourceUrl = encodedPackageUrl(file.relativePath);
  const baseElements = $("base[href]").toArray();
  let effectiveBase = sourceUrl;

  for (const [index, element] of baseElements.entries()) {
    const rawHref = ($(element).attr("href") ?? "").trim();
    if (!rawHref) continue;

    let resolvedBase;
    try {
      resolvedBase = new URL(rawHref.replaceAll("\\", "/"), sourceUrl);
    } catch {
      addError(
        state,
        "BASE_URL_NOT_ALLOWED",
        file.relativePath,
        "The base URL is malformed or unsafe.",
      );
      continue;
    }

    if (
      staticScheme(rawHref) ||
      rawHref.startsWith("/") ||
      rawHref.startsWith("\\") ||
      resolvedBase.origin !== PACKAGE_ORIGIN ||
      !resolvedBase.pathname.startsWith(PACKAGE_PREFIX)
    ) {
      addError(
        state,
        "BASE_URL_NOT_ALLOWED",
        file.relativePath,
        "External and root-relative base URLs are not allowed.",
      );
      continue;
    }

    if (index === 0) effectiveBase = resolvedBase;
  }
  return effectiveBase;
};

const parseSrcset = (value) => {
  const candidates = [];
  let position = 0;

  while (position < value.length) {
    while (/[,\t\n\f\r ]/u.test(value[position] ?? "")) position += 1;
    if (position >= value.length) break;

    const start = position;
    while (
      position < value.length &&
      !/[\t\n\f\r ]/u.test(value[position] ?? "")
    ) {
      position += 1;
    }
    let url = value.slice(start, position);

    let endedByComma = false;
    while (url.endsWith(",")) {
      endedByComma = true;
      url = url.slice(0, -1);
    }
    if (url) candidates.push(url);
    if (endedByComma) continue;

    let parentheses = 0;
    while (position < value.length) {
      const character = value[position];
      if (character === "(") parentheses += 1;
      if (character === ")" && parentheses > 0) parentheses -= 1;
      position += 1;
      if (character === "," && parentheses === 0) break;
    }
  }

  return candidates;
};

const isExternalHttpResource = (rawValue, baseUrl) => {
  const value = rawValue.trim();
  if (!value) return false;

  try {
    const url = new URL(value.replaceAll("\\", "/"), baseUrl);
    return (
      new Set(["http:", "https:"]).has(url.protocol) &&
      url.origin !== PACKAGE_ORIGIN
    );
  } catch {
    return false;
  }
};

function analyzeImportMap(state, sourcePath, contents, baseUrl) {
  let importMap;
  try {
    importMap = JSON.parse(contents);
  } catch {
    addWarning(
      state,
      "IMPORT_MAP_UNPARSEABLE",
      sourcePath,
      "An import map could not be parsed as JSON and requires manual review.",
    );
    return;
  }

  const pending = [{ value: importMap, isMappingValue: true }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    const { value } = entry;
    if (typeof value === "string") {
      if (
        entry.isMappingValue &&
        rejectForbiddenScriptUrl(state, sourcePath, value)
      ) {
        continue;
      }
      if (isExternalHttpResource(value, baseUrl)) {
        resourceTarget(state, sourcePath, value, baseUrl, "script");
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        pending.push({ value: child, isMappingValue: true });
      }
      continue;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        pending.push(
          { value: key, isMappingValue: false },
          { value: child, isMappingValue: true },
        );
      }
    }
  }
}

function analyzeHtml(state, file, contents) {
  const $ = load(contents);
  const baseUrl = baseUrlForHtml(state, file, $);

  $("[target]").each((_, element) => {
    if (
      ($(element).attr("target") ?? "").trim().toLocaleLowerCase("en-US") ===
      "_top"
    ) {
      addError(
        state,
        "TOP_NAVIGATION",
        file.relativePath,
        'target="_top" can navigate the embedding page.',
      );
    }
  });

  $('meta[http-equiv="refresh" i]').each(() => {
    addError(
      state,
      "TOP_NAVIGATION",
      file.relativePath,
      "Meta refresh can navigate the embedding page.",
    );
  });

  $("[src]").each((_, element) => {
    const tagName = element.tagName?.toLocaleLowerCase("en-US");
    resourceTarget(
      state,
      file.relativePath,
      $(element).attr("src") ?? "",
      baseUrl,
      tagName === "script" ? "script" : "resource",
    );
  });
  $("[href]").each((_, element) => {
    const tagName = element.tagName?.toLocaleLowerCase("en-US");
    if (tagName === "base") return;
    resourceTarget(
      state,
      file.relativePath,
      $(element).attr("href") ?? "",
      baseUrl,
      tagName === "script" ? "script" : "resource",
    );
  });
  $("form[action]").each((_, element) => {
    resourceTarget(
      state,
      file.relativePath,
      $(element).attr("action") ?? "",
      baseUrl,
      "form",
    );
  });
  $("[formaction]").each((_, element) => {
    resourceTarget(
      state,
      file.relativePath,
      $(element).attr("formaction") ?? "",
      baseUrl,
      "form",
    );
  });
  $("[poster]").each((_, element) => {
    resourceTarget(
      state,
      file.relativePath,
      $(element).attr("poster") ?? "",
      baseUrl,
      "resource",
    );
  });
  $("object[data]").each((_, element) => {
    resourceTarget(
      state,
      file.relativePath,
      $(element).attr("data") ?? "",
      baseUrl,
      "resource",
    );
  });
  $("[srcset]").each((_, element) => {
    for (const candidate of parseSrcset($(element).attr("srcset") ?? "")) {
      resourceTarget(state, file.relativePath, candidate, baseUrl, "resource");
    }
  });

  $("style").each((_, element) => {
    analyzeCss(state, file.relativePath, $(element).text(), baseUrl);
  });
  $("[style]").each((_, element) => {
    analyzeCss(
      state,
      file.relativePath,
      $(element).attr("style") ?? "",
      baseUrl,
    );
  });

  $("script").each((_, element) => {
    if ($(element).attr("src")) return;
    const type = ($(element).attr("type") ?? "")
      .trim()
      .toLocaleLowerCase("en-US");
    if (type === "importmap") {
      analyzeImportMap(state, file.relativePath, $(element).text(), baseUrl);
      return;
    }
    if (new Set(["application/json", "application/ld+json"]).has(type)) {
      return;
    }
    analyzeScript(state, file.relativePath, $(element).text());
  });

  $("*").each((_, element) => {
    for (const [attribute, value] of Object.entries(element.attribs ?? {})) {
      const normalizedAttribute = attribute.toLocaleLowerCase("en-US");
      if (
        normalizedAttribute === "xlink:href" &&
        element.tagName?.toLocaleLowerCase("en-US") === "script"
      ) {
        resourceTarget(state, file.relativePath, value, baseUrl, "script");
      }
      if (normalizedAttribute.startsWith("on")) {
        analyzeScript(state, file.relativePath, value);
      }
    }
  });
}

function analyzeCss(state, sourcePath, contents, baseUrl) {
  const withoutComments = decodeCssEscapes(
    contents.replace(/\/\*[\s\S]*?\*\//gu, " "),
  );
  const references = [];
  const urlPattern = /url\(\s*(?:(["'])([\s\S]*?)\1|([^)]*?))\s*\)/giu;
  for (const match of withoutComments.matchAll(urlPattern)) {
    references.push(match[2] ?? match[3] ?? "");
  }
  const importPattern = /@import\s+(["'])([\s\S]*?)\1/giu;
  for (const match of withoutComments.matchAll(importPattern)) {
    references.push(match[2] ?? "");
  }

  for (const reference of references) {
    resourceTarget(
      state,
      sourcePath,
      decodeCssEscapes(reference),
      baseUrl,
      "resource",
    );
  }
}

const SCRIPT_GAP = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*`;
const SCRIPT_MEMBER = String.raw`${SCRIPT_GAP}(?:\?\.|\.)${SCRIPT_GAP}`;
const SCRIPT_STRING_LITERAL = String.raw`(?:"(?:\\[\s\S]|[^"\\\r\n])*"|'(?:\\[\s\S]|[^'\\\r\n])*')`;
const SCRIPT_SHALLOW_GROUP = String.raw`\([^()]*\)`;
const SCRIPT_GROUP_PREFIX = String.raw`(?:(?:[^()]|${SCRIPT_SHALLOW_GROUP})*?,${SCRIPT_GAP})?`;
const SCRIPT_TEMPLATE_INTERPOLATION = String.raw`\x60(?:\\[\s\S]|[^\x60\\])*?\$\{`;
const BRACKET_MEMBER_PATTERN = new RegExp(
  String.raw`\[${SCRIPT_GAP}(["'])(top|parent|location|serviceWorker|register|call|apply|open|src|href)\1${SCRIPT_GAP}\]`,
  "giu",
);
const OBVIOUS_SCRIPT_GROUP_PATTERN = new RegExp(
  String.raw`\(${SCRIPT_GAP}${SCRIPT_GROUP_PREFIX}((?:(?:window${SCRIPT_MEMBER})?(?:top|parent)|(?:navigator${SCRIPT_MEMBER})?serviceWorker(?:${SCRIPT_MEMBER}register)?))\b${SCRIPT_GAP}\)`,
  "giu",
);
const TOP_NAVIGATION_PATTERN = new RegExp(
  String.raw`\b(?:window${SCRIPT_MEMBER})?(?:top|parent)${SCRIPT_MEMBER}location\b`,
  "iu",
);
const SERVICE_WORKER_PATTERN = new RegExp(
  String.raw`\b(?:navigator${SCRIPT_MEMBER})?serviceWorker${SCRIPT_MEMBER}register(?:${SCRIPT_MEMBER}(?:call|apply))?${SCRIPT_GAP}(?:\?\.${SCRIPT_GAP})?\(`,
  "iu",
);
const WINDOW_OPEN_PATTERN = new RegExp(
  String.raw`\bwindow${SCRIPT_MEMBER}open${SCRIPT_GAP}\(`,
  "iu",
);
const CONCATENATED_RESOURCE_CALL_PATTERN = new RegExp(
  String.raw`\b(?:fetch|import|importScripts|sendBeacon)${SCRIPT_GAP}\(${SCRIPT_GAP}${SCRIPT_STRING_LITERAL}${SCRIPT_GAP}\+`,
  "iu",
);
const CONCATENATED_RESOURCE_CONSTRUCTOR_PATTERN = new RegExp(
  String.raw`\bnew${SCRIPT_GAP}(?:EventSource|WebSocket|Worker)${SCRIPT_GAP}\(${SCRIPT_GAP}${SCRIPT_STRING_LITERAL}${SCRIPT_GAP}\+`,
  "iu",
);
const DYNAMIC_RESOURCE_CALL_PATTERN = new RegExp(
  String.raw`\b(?:fetch|import|importScripts|sendBeacon)${SCRIPT_GAP}\((?!${SCRIPT_GAP}["'\x60])${SCRIPT_GAP}`,
  "iu",
);
const DYNAMIC_RESOURCE_CONSTRUCTOR_PATTERN = new RegExp(
  String.raw`\bnew${SCRIPT_GAP}(?:EventSource|WebSocket|Worker)${SCRIPT_GAP}\((?!${SCRIPT_GAP}["'\x60])${SCRIPT_GAP}`,
  "iu",
);
const DYNAMIC_RESOURCE_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\.(?:src|href)\b${SCRIPT_GAP}=(?!${SCRIPT_GAP}["'\x60])${SCRIPT_GAP}`,
  "iu",
);
const SET_ATTRIBUTE_DYNAMIC_PATTERN = new RegExp(
  String.raw`\bsetAttribute${SCRIPT_GAP}\(${SCRIPT_GAP}(["'])(?:src|href)\1${SCRIPT_GAP},(?!${SCRIPT_GAP}["'\x60])${SCRIPT_GAP}`,
  "giu",
);
const COMPOSED_RESOURCE_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\.(?:src|href)\b${SCRIPT_GAP}=${SCRIPT_GAP}(?:${SCRIPT_STRING_LITERAL}${SCRIPT_GAP}\+|${SCRIPT_TEMPLATE_INTERPOLATION})`,
  "giu",
);
const COMPOSED_SET_ATTRIBUTE_PATTERN = new RegExp(
  String.raw`\bsetAttribute${SCRIPT_GAP}\(${SCRIPT_GAP}(["'])(?:src|href)\1${SCRIPT_GAP},${SCRIPT_GAP}(?:${SCRIPT_STRING_LITERAL}${SCRIPT_GAP}\+|${SCRIPT_TEMPLATE_INTERPOLATION})`,
  "giu",
);
const SCRIPT_DIRECT_IMPORT_SCRIPTS = String.raw`(?:importScripts|(?:globalThis|self)(?:${SCRIPT_MEMBER}importScripts|${SCRIPT_GAP}\[${SCRIPT_GAP}(?:"importScripts"|'importScripts')${SCRIPT_GAP}\]))`;
const SCRIPT_DIRECT_WORKER_CONSTRUCTOR = String.raw`(?:(?:SharedWorker|Worker)|(?:globalThis|self|window)(?:${SCRIPT_MEMBER}(?:SharedWorker|Worker)|${SCRIPT_GAP}\[${SCRIPT_GAP}(?:"SharedWorker"|'SharedWorker'|"Worker"|'Worker')${SCRIPT_GAP}\]))`;
const SCRIPT_LITERAL_LOADER_PATTERNS = [
  {
    pattern: new RegExp(String.raw`import${SCRIPT_GAP}\(`, "gu"),
    inspectAllArguments: false,
  },
  {
    pattern: new RegExp(
      String.raw`(?:\(${SCRIPT_GAP})*${SCRIPT_DIRECT_IMPORT_SCRIPTS}(?:${SCRIPT_GAP}\))*${SCRIPT_GAP}(?:\?\.${SCRIPT_GAP})?\(`,
      "gu",
    ),
    inspectAllArguments: true,
    validateCalleeGroups: true,
  },
  {
    pattern: new RegExp(
      String.raw`new${SCRIPT_GAP}(?:\(${SCRIPT_GAP})*${SCRIPT_DIRECT_WORKER_CONSTRUCTOR}(?:${SCRIPT_GAP}\))*${SCRIPT_GAP}\(`,
      "gu",
    ),
    inspectAllArguments: false,
    validateCalleeGroups: true,
  },
];
const SCRIPT_ARGUMENT_CLOSING_DELIMITER = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);
const SCRIPT_ARGUMENT_CLOSERS = new Set([")", "]", "}"]);
const SCRIPT_SIMPLE_ESCAPE_VALUE = new Map([
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
  ["'", "'"],
  ['"', '"'],
  ["`", "`"],
  ["\\", "\\"],
]);
const SCRIPT_LINE_CONTINUATIONS = new Set(["\n", "\u2028", "\u2029"]);

const maskScriptCommentsAndStrings = (contents) => {
  const masked = contents.split("");
  const scriptLiteralRanges = [];
  const staticScriptLiterals = [];
  let position = 0;

  const maskCharacter = (index) => {
    if (contents[index] !== "\r" && contents[index] !== "\n") {
      masked[index] = " ";
    }
  };

  const previousSignificantIndex = (from) => {
    let cursor = from;
    while (cursor >= 0 && /\s/u.test(masked[cursor] ?? "")) cursor -= 1;
    return cursor;
  };

  const wordEndingAt = (end) => {
    let start = end;
    while (start >= 0 && /[a-z0-9_$]/iu.test(masked[start] ?? "")) {
      start -= 1;
    }
    return masked.slice(start + 1, end + 1).join("");
  };

  const matchingOpeningIndex = (
    closing,
    openingCharacter,
    closingCharacter,
  ) => {
    let depth = 1;
    for (let cursor = closing - 1; cursor >= 0; cursor -= 1) {
      if (masked[cursor] === closingCharacter) depth += 1;
      if (masked[cursor] === openingCharacter) {
        depth -= 1;
        if (depth === 0) return cursor;
      }
    }
    return -1;
  };

  const isControlStatementCloseParen = (closing) => {
    const opening = matchingOpeningIndex(closing, "(", ")");
    if (opening < 0) return false;
    const wordEnd = previousSignificantIndex(opening - 1);
    if (wordEnd < 0) return false;
    return new Set(["catch", "for", "if", "switch", "while", "with"]).has(
      wordEndingAt(wordEnd),
    );
  };

  const identifierTokenEndingAt = (end) => {
    if (!/[$_\p{ID_Continue}\u200c\u200d]/u.test(masked[end] ?? "")) {
      return;
    }
    let start = end;
    while (
      start >= 0 &&
      /[$_\p{ID_Continue}\u200c\u200d]/u.test(masked[start] ?? "")
    ) {
      start -= 1;
    }
    return {
      start: start + 1,
      word: masked.slice(start + 1, end + 1).join(""),
    };
  };

  const isDeclarationBoundaryBefore = (start) => {
    const previous = previousSignificantIndex(start - 1);
    if (previous < 0 || new Set(["{", "}", ";"]).has(masked[previous])) {
      return true;
    }
    const token = identifierTokenEndingAt(previous);
    if (!token || !new Set(["async", "default", "export"]).has(token.word)) {
      return false;
    }
    return isDeclarationBoundaryBefore(token.start);
  };

  const isFunctionDeclarationOpening = (opening) => {
    const parametersClosing = previousSignificantIndex(opening - 1);
    if (masked[parametersClosing] !== ")") return false;
    const parametersOpening = matchingOpeningIndex(parametersClosing, "(", ")");
    if (parametersOpening < 0) return false;

    const nameEnd = previousSignificantIndex(parametersOpening - 1);
    if (masked[nameEnd] === "*") {
      const functionEnd = previousSignificantIndex(nameEnd - 1);
      const functionToken = identifierTokenEndingAt(functionEnd);
      return (
        functionToken?.word === "function" &&
        isDeclarationBoundaryBefore(functionToken.start)
      );
    }
    const name = identifierTokenEndingAt(nameEnd);
    if (!name) return false;
    if (name.word === "function") {
      return isDeclarationBoundaryBefore(name.start);
    }
    let functionEnd = previousSignificantIndex(name.start - 1);
    if (masked[functionEnd] === "*") {
      functionEnd = previousSignificantIndex(functionEnd - 1);
    }
    const functionToken = identifierTokenEndingAt(functionEnd);
    return (
      functionToken?.word === "function" &&
      isDeclarationBoundaryBefore(functionToken.start)
    );
  };

  const isClassDeclarationOpening = (opening) => {
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;

    for (let cursor = opening - 1; cursor >= 0; cursor -= 1) {
      const character = masked[cursor];
      if (character === ")") parentheses += 1;
      else if (character === "(" && parentheses > 0) parentheses -= 1;
      else if (character === "]") brackets += 1;
      else if (character === "[" && brackets > 0) brackets -= 1;
      else if (character === "}") braces += 1;
      else if (character === "{" && braces > 0) braces -= 1;
      else if (
        parentheses === 0 &&
        brackets === 0 &&
        braces === 0 &&
        new Set(["{", "}", ";"]).has(character)
      ) {
        return false;
      }

      if (parentheses !== 0 || brackets !== 0 || braces !== 0) continue;
      const token = identifierTokenEndingAt(cursor);
      if (!token) continue;
      if (token.word === "class") {
        return isDeclarationBoundaryBefore(token.start);
      }
      cursor = token.start;
    }
    return false;
  };

  const isStatementBlockCloseBrace = (closing) => {
    const opening = matchingOpeningIndex(closing, "{", "}");
    if (opening < 0) return false;
    const previous = previousSignificantIndex(opening - 1);
    if (previous < 0) return true;
    if (masked[previous] === ")") {
      return (
        isControlStatementCloseParen(previous) ||
        isFunctionDeclarationOpening(opening)
      );
    }
    return (
      isClassDeclarationOpening(opening) ||
      new Set(["do", "else", "finally", "try"]).has(wordEndingAt(previous))
    );
  };

  const canStartRegexLiteral = () => {
    let previous = previousSignificantIndex(position - 1);
    if (previous < 0) return true;

    const previousCharacter = masked[previous] ?? "";
    if ("([{,:;=!?&|+-*%^~<>".includes(previousCharacter)) return true;
    if (
      (previousCharacter === ")" && isControlStatementCloseParen(previous)) ||
      (previousCharacter === "}" && isStatementBlockCloseBrace(previous))
    ) {
      return true;
    }

    const wordEnd = previous + 1;
    while (previous >= 0 && /[a-z0-9_$]/iu.test(masked[previous] ?? "")) {
      previous -= 1;
    }
    const previousWord = masked.slice(previous + 1, wordEnd).join("");
    return new Set([
      "await",
      "case",
      "delete",
      "do",
      "else",
      "in",
      "instanceof",
      "of",
      "return",
      "throw",
      "typeof",
      "void",
      "yield",
    ]).has(previousWord);
  };

  const maskRegexLiteral = () => {
    if (!canStartRegexLiteral()) return false;

    let cursor = position + 1;
    let inCharacterClass = false;
    while (cursor < contents.length) {
      const character = contents[cursor];
      if (character === "\r" || character === "\n") return false;
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      if (character === "[") {
        inCharacterClass = true;
      } else if (character === "]") {
        inCharacterClass = false;
      } else if (character === "/" && !inCharacterClass) {
        cursor += 1;
        while (/[a-z]/iu.test(contents[cursor] ?? "")) cursor += 1;
        while (position < cursor) {
          maskCharacter(position);
          position += 1;
        }
        return true;
      }
      cursor += 1;
    }
    return false;
  };

  const maskHtmlComment = () => {
    const closing = contents.indexOf("-->", position + 4);
    const end = closing < 0 ? contents.length : closing + 3;
    while (position < end) {
      maskCharacter(position);
      position += 1;
    }
  };

  const maskLineComment = () => {
    while (
      position < contents.length &&
      contents[position] !== "\r" &&
      contents[position] !== "\n"
    ) {
      maskCharacter(position);
      position += 1;
    }
  };

  const maskBlockComment = () => {
    while (position < contents.length) {
      const closesComment =
        contents[position] === "*" && contents[position + 1] === "/";
      maskCharacter(position);
      position += 1;
      if (closesComment) {
        maskCharacter(position);
        position += 1;
        return;
      }
    }
  };

  const maskQuotedString = (quote) => {
    const start = position;
    position += 1;
    while (position < contents.length) {
      const character = contents[position];
      if (character === "\\") {
        maskCharacter(position);
        position += 1;
        if (position < contents.length) {
          maskCharacter(position);
          position += 1;
        }
        continue;
      }
      if (character === quote) {
        position += 1;
        const literal = {
          start,
          end: position,
          value: contents.slice(start + 1, position - 1),
        };
        scriptLiteralRanges.push(literal);
        staticScriptLiterals.push(literal);
        return;
      }
      maskCharacter(position);
      position += 1;
    }
  };

  function maskTemplateLiteral() {
    const start = position;
    let hasInterpolation = false;
    position += 1;
    while (position < contents.length) {
      const character = contents[position];
      if (character === "\\") {
        maskCharacter(position);
        position += 1;
        if (position < contents.length) {
          maskCharacter(position);
          position += 1;
        }
        continue;
      }
      if (character === "`") {
        position += 1;
        const literal = {
          start,
          end: position,
          value: contents.slice(start + 1, position - 1),
        };
        scriptLiteralRanges.push(literal);
        if (!hasInterpolation) staticScriptLiterals.push(literal);
        return;
      }
      if (character === "$" && contents[position + 1] === "{") {
        hasInterpolation = true;
        maskCharacter(position);
        maskCharacter(position + 1);
        position += 2;
        scanCode(true);
        continue;
      }
      maskCharacter(position);
      position += 1;
    }
  }

  function scanCode(templateExpression = false) {
    let braceDepth = templateExpression ? 1 : 0;
    while (position < contents.length) {
      const character = contents[position];
      const nextCharacter = contents[position + 1];

      if (contents.startsWith("<!--", position)) {
        maskHtmlComment();
        continue;
      }
      if (character === "/" && nextCharacter === "/") {
        maskLineComment();
        continue;
      }
      if (character === "/" && nextCharacter === "*") {
        maskBlockComment();
        continue;
      }
      if (character === "/" && maskRegexLiteral()) {
        continue;
      }
      if (character === '"' || character === "'") {
        maskQuotedString(character);
        continue;
      }
      if (character === "`") {
        maskTemplateLiteral();
        continue;
      }
      if (templateExpression && character === "{") {
        braceDepth += 1;
      } else if (templateExpression && character === "}") {
        braceDepth -= 1;
        if (braceDepth === 0) {
          maskCharacter(position);
          position += 1;
          return;
        }
      }
      position += 1;
    }
  }

  scanCode();
  return {
    codeSource: masked.join(""),
    scriptLiteralRanges,
    staticScriptLiterals,
  };
};

const normalizeObviousScriptMembers = (
  contents,
  codeSource,
  sourceToNormalize = codeSource,
) => {
  const replacements = [];
  BRACKET_MEMBER_PATTERN.lastIndex = 0;
  for (const match of contents.matchAll(BRACKET_MEMBER_PATTERN)) {
    const index = match.index ?? -1;
    if (index >= 0 && codeSource[index] === "[") {
      replacements.push({
        index,
        length: match[0].length,
        property: match[2],
      });
    }
  }

  let normalized = sourceToNormalize;
  for (const replacement of replacements.reverse()) {
    const member = `.${replacement.property}`.padEnd(replacement.length, " ");
    normalized = `${normalized.slice(0, replacement.index)}${member}${normalized.slice(replacement.index + replacement.length)}`;
  }
  return normalized;
};

const normalizeObviousScriptGroups = (codeSource) => {
  let normalized = codeSource;
  while (true) {
    let changed = false;
    normalized = normalized.replace(
      OBVIOUS_SCRIPT_GROUP_PATTERN,
      (match, expression) => {
        changed = true;
        return expression.padEnd(match.length, " ");
      },
    );
    if (!changed) return normalized;
  }
};

const hasExecutablePatternMatch = (contents, codeSource, pattern) => {
  pattern.lastIndex = 0;
  for (const match of contents.matchAll(pattern)) {
    const index = match.index ?? -1;
    if (index >= 0 && codeSource[index] === contents[index]) return true;
  }
  return false;
};

const isExecutableBareScriptToken = (contents, codeSource, index) => {
  if (index < 0 || codeSource[index] !== contents[index]) return false;
  if (/[$#\p{ID_Continue}\u200c\u200d]/u.test(codeSource[index - 1] ?? "")) {
    return false;
  }

  let previous = index - 1;
  while (previous >= 0 && /\s/u.test(codeSource[previous] ?? "")) {
    previous -= 1;
  }
  return codeSource[previous] !== ".";
};

const decodeStaticScriptLiteral = (rawValue) => {
  let decoded = "";
  let position = 0;

  while (position < rawValue.length) {
    const character = rawValue[position];
    if (character !== "\\") {
      decoded += character;
      position += 1;
      continue;
    }

    const escaped = rawValue[position + 1];
    if (escaped === undefined) return { reliable: false };
    if (SCRIPT_LINE_CONTINUATIONS.has(escaped)) {
      position += 2;
      continue;
    }
    if (escaped === "\r") {
      position += rawValue[position + 2] === "\n" ? 3 : 2;
      continue;
    }

    const simpleValue = SCRIPT_SIMPLE_ESCAPE_VALUE.get(escaped);
    if (simpleValue !== undefined) {
      decoded += simpleValue;
      position += 2;
      continue;
    }
    if (/[0-7]/u.test(escaped)) {
      const maximumDigits = /[0-3]/u.test(escaped) ? 3 : 2;
      let digits = escaped;
      while (
        digits.length < maximumDigits &&
        /[0-7]/u.test(rawValue[position + 1 + digits.length] ?? "")
      ) {
        digits += rawValue[position + 1 + digits.length];
      }
      decoded += String.fromCharCode(Number.parseInt(digits, 8));
      position += digits.length + 1;
      continue;
    }
    if (/[89]/u.test(escaped)) return { reliable: false };

    if (escaped === "x") {
      const hex = rawValue.slice(position + 2, position + 4);
      if (!/^[\da-f]{2}$/iu.test(hex)) return { reliable: false };
      decoded += String.fromCharCode(Number.parseInt(hex, 16));
      position += 4;
      continue;
    }

    if (escaped === "u") {
      if (rawValue[position + 2] === "{") {
        const closingBrace = rawValue.indexOf("}", position + 3);
        if (closingBrace < 0) return { reliable: false };
        const hex = rawValue.slice(position + 3, closingBrace);
        if (!/^[\da-f]+$/iu.test(hex)) return { reliable: false };
        const codePoint = Number.parseInt(hex, 16);
        if (codePoint > 0x10ffff) return { reliable: false };
        decoded += String.fromCodePoint(codePoint);
        position = closingBrace + 1;
        continue;
      }

      const hex = rawValue.slice(position + 2, position + 6);
      if (!/^[\da-f]{4}$/iu.test(hex)) return { reliable: false };
      decoded += String.fromCharCode(Number.parseInt(hex, 16));
      position += 6;
      continue;
    }

    decoded += escaped;
    position += 2;
  }

  return { reliable: true, value: decoded };
};

const warnDynamicResource = (state, sourcePath) => {
  addWarning(
    state,
    "DYNAMIC_RESOURCE",
    sourcePath,
    "An unrecognized dynamic resource load requires manual review.",
  );
};

const nextScriptArgumentStart = (
  codeSource,
  scriptLiteralRangeEndByStart,
  start,
) => {
  const closingDelimiters = [];
  let position = start;

  while (position < codeSource.length) {
    const literalEnd = scriptLiteralRangeEndByStart.get(position);
    if (literalEnd !== undefined) {
      position = literalEnd;
      continue;
    }

    const character = codeSource[position];
    const closingDelimiter = SCRIPT_ARGUMENT_CLOSING_DELIMITER.get(character);
    if (closingDelimiter) {
      closingDelimiters.push(closingDelimiter);
      position += 1;
      continue;
    }
    if (SCRIPT_ARGUMENT_CLOSERS.has(character)) {
      if (closingDelimiters.length === 0) return;
      if (closingDelimiters.pop() !== character) return;
      position += 1;
      continue;
    }
    if (character === "," && closingDelimiters.length === 0) {
      return position + 1;
    }
    position += 1;
  }
};

const staticScriptLiteralArgument = (
  codeSource,
  staticScriptLiteralByStart,
  start,
) => {
  let position = start;
  while (/\s/u.test(codeSource[position] ?? "")) position += 1;

  let groupingDepth = 0;
  while (codeSource[position] === "(") {
    groupingDepth += 1;
    position += 1;
    while (/\s/u.test(codeSource[position] ?? "")) position += 1;
  }

  const literal = staticScriptLiteralByStart.get(position);
  if (!literal) return;
  position = literal.end;
  while (/\s/u.test(codeSource[position] ?? "")) position += 1;

  while (groupingDepth > 0) {
    if (codeSource[position] !== ")") return;
    groupingDepth -= 1;
    position += 1;
    while (/\s/u.test(codeSource[position] ?? "")) position += 1;
  }

  if (!new Set([",", ")"]).has(codeSource[position])) return;
  return { literal, end: position };
};

const enumerateStaticScriptArguments = (
  codeSource,
  staticScriptLiteralByStart,
  scriptLiteralRangeEndByStart,
  openingParenthesis,
  inspectAllArguments,
) => {
  const literals = [];
  let position = openingParenthesis + 1;

  while (position < codeSource.length) {
    const argument = staticScriptLiteralArgument(
      codeSource,
      staticScriptLiteralByStart,
      position,
    );
    if (argument) literals.push(argument.literal);
    if (!inspectAllArguments) break;

    const nextArgument = nextScriptArgumentStart(
      codeSource,
      scriptLiteralRangeEndByStart,
      argument?.end ?? position,
    );
    if (nextArgument === undefined) break;
    position = nextArgument;
  }

  return literals;
};

const hasBalancedCalleeGroups = (codeSource, start, openingParenthesis) => {
  let depth = 0;
  for (let position = start; position < openingParenthesis; position += 1) {
    if (codeSource[position] === "(") depth += 1;
    if (codeSource[position] === ")") {
      if (depth === 0) return false;
      depth -= 1;
    }
  }
  return depth === 0;
};

const inspectLiteralScriptUrls = (
  state,
  sourcePath,
  contents,
  codeSource,
  staticScriptLiteralByStart,
  scriptLiteralRangeEndByStart,
) => {
  for (const {
    pattern,
    inspectAllArguments,
    validateCalleeGroups,
  } of SCRIPT_LITERAL_LOADER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      const index = match.index ?? -1;
      if (!isExecutableBareScriptToken(contents, codeSource, index)) continue;
      const openingParenthesis = index + match[0].length - 1;
      if (
        validateCalleeGroups &&
        !hasBalancedCalleeGroups(codeSource, index, openingParenthesis)
      ) {
        continue;
      }
      for (const literal of enumerateStaticScriptArguments(
        codeSource,
        staticScriptLiteralByStart,
        scriptLiteralRangeEndByStart,
        openingParenthesis,
        inspectAllArguments,
      )) {
        const decoded = decodeStaticScriptLiteral(literal.value);
        if (!decoded.reliable) {
          warnDynamicResource(state, sourcePath);
          continue;
        }
        rejectForbiddenScriptUrl(state, sourcePath, decoded.value);
      }
    }
  }
};

function analyzeScript(state, sourcePath, contents) {
  const { codeSource, scriptLiteralRanges, staticScriptLiterals } =
    maskScriptCommentsAndStrings(contents);
  const staticScriptLiteralByStart = new Map(
    staticScriptLiterals.map((literal) => [literal.start, literal]),
  );
  const scriptLiteralRangeEndByStart = new Map(
    scriptLiteralRanges.map((literal) => [literal.start, literal.end]),
  );
  inspectLiteralScriptUrls(
    state,
    sourcePath,
    contents,
    codeSource,
    staticScriptLiteralByStart,
    scriptLiteralRangeEndByStart,
  );
  const normalizedMemberCode = normalizeObviousScriptMembers(
    contents,
    codeSource,
  );
  const memberSource = normalizeObviousScriptGroups(normalizedMemberCode);
  const resourceMemberSource = normalizeObviousScriptMembers(
    contents,
    codeSource,
    contents,
  );
  const topNavigation = TOP_NAVIGATION_PATTERN.test(memberSource);
  if (topNavigation) {
    addError(
      state,
      "TOP_NAVIGATION",
      sourcePath,
      "Obvious top-level or parent navigation code was found.",
    );
  }

  if (SERVICE_WORKER_PATTERN.test(memberSource)) {
    addError(
      state,
      "SERVICE_WORKER",
      sourcePath,
      "Service Worker registration is not allowed.",
    );
  }

  if (WINDOW_OPEN_PATTERN.test(memberSource)) {
    addWarning(
      state,
      "WINDOW_OPEN",
      sourcePath,
      "window.open usage requires manual review.",
    );
  }

  if (
    /["'`][\t\n\f\r ]*(?:https?:\/\/|wss?:\/\/|\/\/[a-z0-9.-]+(?:[/:?#]|["'`]))/iu.test(
      contents,
    )
  ) {
    addWarning(
      state,
      "EXTERNAL_NETWORK",
      sourcePath,
      "A possible third-party network request requires manual review.",
    );
  }

  if (
    DYNAMIC_RESOURCE_CALL_PATTERN.test(memberSource) ||
    DYNAMIC_RESOURCE_CONSTRUCTOR_PATTERN.test(memberSource) ||
    /\b(?:fetch|import|importScripts|sendBeacon)\s*\(\s*`[^`]*\$\{/iu.test(
      contents,
    ) ||
    /\bnew\s+(?:EventSource|WebSocket|Worker)\s*\(\s*`[^`]*\$\{/iu.test(
      contents,
    ) ||
    CONCATENATED_RESOURCE_CALL_PATTERN.test(contents) ||
    CONCATENATED_RESOURCE_CONSTRUCTOR_PATTERN.test(contents) ||
    DYNAMIC_RESOURCE_ASSIGNMENT_PATTERN.test(memberSource) ||
    hasExecutablePatternMatch(
      contents,
      codeSource,
      SET_ATTRIBUTE_DYNAMIC_PATTERN,
    ) ||
    hasExecutablePatternMatch(
      resourceMemberSource,
      normalizedMemberCode,
      COMPOSED_RESOURCE_ASSIGNMENT_PATTERN,
    ) ||
    hasExecutablePatternMatch(
      contents,
      codeSource,
      COMPOSED_SET_ATTRIBUTE_PATTERN,
    )
  ) {
    warnDynamicResource(state, sourcePath);
  }
}

/**
 * Validate a static game package without uploading it or using credentials.
 *
 * @param {string} directory
 * @param {{ maxFileBytes?: number, largeAssetWarningBytes?: number }} [options]
 */
export async function validateGamePackage(directory, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const largeAssetWarningBytes =
    options.largeAssetWarningBytes ?? DEFAULT_LARGE_ASSET_WARNING_BYTES;
  const report = createReport(maxFileBytes);
  const state = {
    report,
    issueKeys: new Set(),
    rootPath: resolve(directory),
    rootRealPath: "",
    files: [],
    filePaths: new Set(),
    directories: new Set(),
    options: { maxFileBytes, largeAssetWarningBytes },
  };

  if (!Number.isFinite(maxFileBytes) || maxFileBytes <= 0) {
    addError(
      state,
      "MAX_FILE_SIZE_INVALID",
      undefined,
      "The maximum file size must be a finite positive number of bytes.",
    );
    return finalizeReport(state);
  }

  let rootMetadata;
  try {
    rootMetadata = await lstat(state.rootPath);
  } catch (error) {
    addError(
      state,
      isMissingError(error) ? "DIRECTORY_MISSING" : "DIRECTORY_UNREADABLE",
      undefined,
      isMissingError(error)
        ? "The game package directory does not exist."
        : "The game package directory could not be inspected.",
    );
    return finalizeReport(state);
  }

  if (rootMetadata.isSymbolicLink()) {
    addError(
      state,
      "PACKAGE_ROOT_SYMLINK",
      undefined,
      "The package root must not be a symbolic link or junction.",
    );
    return finalizeReport(state);
  }
  if (!rootMetadata.isDirectory()) {
    addError(
      state,
      "PACKAGE_ROOT_NOT_DIRECTORY",
      undefined,
      "The game package path must be a directory.",
    );
    return finalizeReport(state);
  }

  try {
    state.rootRealPath = await realpath(state.rootPath);
  } catch {
    addError(
      state,
      "DIRECTORY_UNREADABLE",
      undefined,
      "The game package directory could not be resolved.",
    );
    return finalizeReport(state);
  }

  await walkPackage(state, state.rootPath);
  state.files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  state.filePaths = new Set(
    state.files.map(({ relativePath }) => relativePath),
  );
  report.summary.fileCount = state.files.length;
  report.summary.totalBytes = state.files.reduce(
    (total, file) => total + file.size,
    0,
  );

  await verifyEntryFile(state);
  for (const file of state.files) await inspectFile(state, file);

  return finalizeReport(state);
}

const finalizeReport = (state) => {
  state.report.errors.sort(issueSort);
  state.report.warnings.sort(issueSort);
  state.report.ok = state.report.errors.length === 0;
  return state.report;
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MEBIBYTE) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / MEBIBYTE).toFixed(1)} MiB`;
};

const formatIssueList = (label, issues) => {
  if (issues.length === 0) return `${label}: none`;
  return [
    `${label} (${issues.length}):`,
    ...issues.map((issue) => {
      const safePath = issue.path ? sanitizeIssuePath(issue.path) : undefined;
      return `- [${issue.code}]${safePath ? ` ${safePath}:` : ""} ${issue.message}`;
    }),
  ].join("\n");
};

/** @param {Awaited<ReturnType<typeof validateGamePackage>>} report */
export function formatHumanReport(report) {
  return [
    `Game package validation: ${report.ok ? "PASS" : "FAIL"}`,
    `Files: ${report.summary.fileCount}`,
    `Total size: ${formatBytes(report.summary.totalBytes)}`,
    `Entry: ${report.summary.entry}`,
    `Maximum file size: ${formatBytes(report.summary.maxFileBytes)}`,
    formatIssueList("Errors", report.errors),
    formatIssueList("Warnings", report.warnings),
  ].join("\n");
}

class CliUsageError extends Error {}

const parsePositiveMegabytes = (raw) => {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(raw)) throw new CliUsageError();
  const megabytes = Number(raw);
  const bytes = Math.floor(megabytes * MEBIBYTE);
  if (!Number.isFinite(megabytes) || megabytes <= 0 || bytes < 1) {
    throw new CliUsageError();
  }
  return bytes;
};

export function parseCliArgs(argv) {
  let json = false;
  let maxFileBytes = DEFAULT_MAX_FILE_BYTES;
  const directories = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--max-file-mb") {
      const value = argv[index + 1];
      if (!value) throw new CliUsageError();
      maxFileBytes = parsePositiveMegabytes(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--max-file-mb=")) {
      maxFileBytes = parsePositiveMegabytes(
        argument.slice("--max-file-mb=".length),
      );
      continue;
    }
    if (argument.startsWith("-")) throw new CliUsageError();
    directories.push(argument);
  }

  if (directories.length !== 1) throw new CliUsageError();
  return { directory: directories[0], json, maxFileBytes };
}

const cliUsageReport = () => {
  const report = createReport(DEFAULT_MAX_FILE_BYTES);
  report.errors.push({
    code: "CLI_USAGE",
    message:
      "Usage: validate-game-package [--json] [--max-file-mb N] <directory>",
  });
  return report;
};

async function main() {
  const wantsJson = process.argv.slice(2).includes("--json");
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch {
    const report = cliUsageReport();
    process.stdout.write(
      wantsJson
        ? `${JSON.stringify(report)}\n`
        : `${formatHumanReport(report)}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const report = await validateGamePackage(args.directory, {
    maxFileBytes: args.maxFileBytes,
  });
  process.stdout.write(
    args.json
      ? `${JSON.stringify(report)}\n`
      : `${formatHumanReport(report)}\n`,
  );
  process.exitCode = report.ok ? 0 : 1;
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch(() => {
    const report = createReport(DEFAULT_MAX_FILE_BYTES);
    report.errors.push({
      code: "INTERNAL_ERROR",
      message: "The validator could not complete safely.",
    });
    process.stdout.write(
      process.argv.slice(2).includes("--json")
        ? `${JSON.stringify(report)}\n`
        : `${formatHumanReport(report)}\n`,
    );
    process.exitCode = 1;
  });
}
