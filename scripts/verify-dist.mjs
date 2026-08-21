import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "cheerio";
import { loadEnv } from "vite";

import {
  GAME_FRAME_ALLOW,
  GAME_FRAME_REFERRER_POLICY,
  GAME_FRAME_SANDBOX,
  getGameFrameAttributes,
} from "../src/components/games/game-player.ts";
import {
  assertCrossOrigin,
  DEFAULT_GAME_ORIGIN,
  parseAllowedGameOrigins,
  validateEmbedUrl,
} from "../src/lib/embed-url.ts";
import { resolveSiteOrigin } from "../src/lib/site-origin.ts";

const MAX_PAGE_TITLE_LENGTH = 65;
const REQUIRED_OPEN_GRAPH_FIELDS = [
  "og:type",
  "og:site_name",
  "og:title",
  "og:description",
  "og:url",
  "og:image",
];
const REQUIRED_TWITTER_FIELDS = [
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
];
const SITE_JSON_LD_URL_KEYS = new Set(["@id", "image", "item", "url"]);
const EXTERNAL_JSON_LD_URL_KEYS = new Set(["@context", "availability"]);
const FORBIDDEN_SANDBOX_TOKENS = new Set([
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-top-navigation",
  "allow-top-navigation-by-user-activation",
  "allow-forms",
  "allow-modals",
  "allow-downloads",
]);
const FORBIDDEN_FRAME_PERMISSIONS = new Set([
  "camera",
  "microphone",
  "geolocation",
  "clipboard",
  "clipboard-read",
  "clipboard-write",
  "payment",
  "web-share",
]);

const toPosixPath = (path) => path.replaceAll("\\", "/");

/**
 * Return every generated file as a sorted, dist-relative POSIX path.
 *
 * @param {string} distDirectory
 * @returns {Promise<string[]>}
 */
export async function listOutputFiles(distDirectory) {
  /** @type {string[]} */
  const files = [];

  /** @param {string} directory */
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
        } else if (entry.isFile()) {
          files.push(toPosixPath(relative(distDirectory, path)));
        }
      }),
    );
  }

  try {
    await walk(distDirectory);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error("dist directory is missing");
    }
    throw error;
  }

  return files.sort();
}

/** @param {string} distDirectory */
export async function listHtmlFiles(distDirectory) {
  return (await listOutputFiles(distDirectory)).filter((file) =>
    file.toLocaleLowerCase().endsWith(".html"),
  );
}

/** @param {string} file */
export function htmlFileToRoute(file) {
  const normalized = toPosixPath(file).replace(/^\.\//, "");

  if (normalized === "index.html") return "/";
  if (normalized.endsWith("/index.html")) {
    return `/${normalized.slice(0, -"index.html".length)}`;
  }
  return `/${normalized}`;
}

/**
 * @param {string} href
 * @param {string} baseUrl
 * @param {string} siteOrigin
 */
export function internalLinkPath(href, baseUrl, siteOrigin) {
  const value = href.trim();
  if (!value || value.startsWith("#")) return undefined;

  const url = new URL(value, baseUrl);
  if (!new Set(["http:", "https:"]).has(url.protocol)) return undefined;
  if (url.origin !== siteOrigin) return undefined;
  return url.pathname;
}

/** @param {unknown} error */
function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * @param {string} distDirectory
 * @param {string} file
 */
async function readBuiltFile(distDirectory, file) {
  try {
    return await readFile(resolve(distDirectory, ...file.split("/")), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`dist/${file} is missing`);
    }
    throw error;
  }
}

/**
 * @param {import("cheerio").CheerioAPI} $
 * @param {string} attribute
 * @param {string} key
 */
function metaElements($, attribute, key) {
  const expected = key.toLocaleLowerCase();
  return $("meta").filter((_index, element) => {
    return (
      ($(element).attr(attribute) ?? "").trim().toLocaleLowerCase() === expected
    );
  });
}

/** @param {import("cheerio").CheerioAPI} $ */
function canonicalElements($) {
  return $("link").filter((_index, element) => {
    const tokens = ($(element).attr("rel") ?? "")
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return tokens.includes("canonical");
  });
}

/**
 * @param {string[]} issues
 * @param {string} file
 * @param {import("cheerio").Cheerio<import("domhandler").AnyNode>} elements
 * @param {string} label
 * @param {string} attribute
 */
function readSingletonAttribute(issues, file, elements, label, attribute) {
  if (elements.length !== 1) {
    issues.push(
      `dist/${file} must contain exactly one non-empty ${label}; found ${elements.length}`,
    );
    return undefined;
  }

  const value = elements.attr(attribute)?.trim();
  if (!value) {
    issues.push(`dist/${file} must contain exactly one non-empty ${label}`);
    return undefined;
  }
  return value;
}

/**
 * @param {string[]} issues
 * @param {string} label
 * @param {string} value
 * @param {{ origin?: string, allowExternalOrigin?: boolean }} [options]
 */
function readHttpsUrl(issues, label, value, options = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    issues.push(`${label} must be an absolute HTTPS URL`);
    return undefined;
  }

  if (url.username || url.password) {
    issues.push(`${label} must not contain credentials`);
    return undefined;
  }
  if (url.protocol !== "https:") {
    issues.push(`${label} must use HTTPS`);
  }
  if (
    options.origin &&
    !options.allowExternalOrigin &&
    url.origin !== options.origin
  ) {
    issues.push(`${label} origin must match site origin ${options.origin}`);
  }
  return url;
}

/**
 * @param {unknown} value
 * @param {Set<string>} types
 */
function collectSchemaTypes(value, types) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSchemaTypes(entry, types));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = /** @type {Record<string, unknown>} */ (value);
  const type = record["@type"];
  if (typeof type === "string") types.add(type);
  if (Array.isArray(type)) {
    type.forEach((entry) => {
      if (typeof entry === "string") types.add(entry);
    });
  }
  Object.values(record).forEach((entry) => collectSchemaTypes(entry, types));
}

/**
 * @param {unknown} value
 * @param {Record<string, unknown>[]} objects
 */
function collectSchemaObjects(value, objects) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSchemaObjects(entry, objects));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = /** @type {Record<string, unknown>} */ (value);
  if (typeof record["@type"] === "string" || Array.isArray(record["@type"])) {
    objects.push(record);
  }
  Object.values(record).forEach((entry) =>
    collectSchemaObjects(entry, objects),
  );
}

/**
 * @param {unknown} value
 * @param {string | undefined} key
 * @param {string} path
 * @param {string | undefined} siteOrigin
 * @param {string[]} issues
 * @param {string} file
 * @param {Set<string>} outputPaths
 */
function validateJsonLdValue(
  value,
  key,
  path,
  siteOrigin,
  issues,
  file,
  outputPaths,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateJsonLdValue(
        entry,
        key,
        `${path}[${index}]`,
        siteOrigin,
        issues,
        file,
        outputPaths,
      ),
    );
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [childKey, childValue] of Object.entries(value)) {
      validateJsonLdValue(
        childValue,
        childKey,
        `${path}.${childKey}`,
        siteOrigin,
        issues,
        file,
        outputPaths,
      );
    }
    return;
  }
  if (typeof value !== "string") return;

  if (value.trim() === "undefined") {
    issues.push(`dist/${file} JSON-LD contains undefined string at ${path}`);
  }
  if (key && SITE_JSON_LD_URL_KEYS.has(key)) {
    const url = readHttpsUrl(
      issues,
      `dist/${file} JSON-LD URL at ${path}`,
      value,
      {
        ...(siteOrigin ? { origin: siteOrigin } : {}),
      },
    );
    if (
      url &&
      siteOrigin &&
      url.origin === siteOrigin &&
      !outputPaths.has(url.pathname)
    ) {
      issues.push(
        `dist/${file} JSON-LD URL target is missing at ${path}: ${url.pathname}`,
      );
    }
  } else if (key && EXTERNAL_JSON_LD_URL_KEYS.has(key)) {
    readHttpsUrl(issues, `dist/${file} JSON-LD URL at ${path}`, value, {
      allowExternalOrigin: true,
    });
  }
}

/**
 * @param {string} file
 * @param {string} html
 */
function createPage(file, html) {
  return {
    $: load(html),
    file,
    route: htmlFileToRoute(file),
    canonical: undefined,
    canonicalUrl: undefined,
    robots: undefined,
    schemaObjects: [],
    schemaTypes: new Set(),
    title: undefined,
  };
}

/**
 * @param {ReturnType<typeof createPage>} page
 * @param {string[]} issues
 * @param {string | undefined} siteOrigin
 * @param {readonly URL[]} allowedGameOrigins
 */
function validateGamePlayer(page, issues, siteOrigin, allowedGameOrigins) {
  const { $, file } = page;
  const roots = $("[data-game-player]");

  if (roots.length !== 1) {
    issues.push(
      `Game page dist/${file} must contain exactly one GamePlayer root; found ${roots.length}`,
    );
    return;
  }

  const root = roots.first();
  const loadMode = root.attr("data-load-mode")?.trim();
  if (loadMode !== "click" && loadMode !== "eager") {
    issues.push(
      `GamePlayer in dist/${file} must use data-load-mode="click" or "eager"`,
    );
  }

  const title = root.attr("data-title")?.trim();
  if (!title) {
    issues.push(
      `GamePlayer in dist/${file} must contain a non-empty data-title`,
    );
  }

  const rawSource = root.attr("data-src")?.trim();
  let sourceUrl;
  if (!rawSource) {
    issues.push(`GamePlayer data-src in dist/${file} must not be empty`);
  } else {
    try {
      const parsedSource = new URL(rawSource);
      if (siteOrigin) {
        assertCrossOrigin(parsedSource, new URL(siteOrigin));
      }
      sourceUrl = validateEmbedUrl(rawSource, allowedGameOrigins);
    } catch (error) {
      issues.push(
        `GamePlayer data-src in dist/${file} is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const playButtons = root.find('button[data-game-play][type="button"]');
  const allFrames = $("iframe");
  const playerFrames = root.find("iframe");

  if (loadMode === "click") {
    if (playButtons.length !== 1 || !playButtons.first().text().trim()) {
      issues.push(
        `Click GamePlayer in dist/${file} must contain exactly one non-empty native Play button`,
      );
    }
    if (allFrames.length !== 0) {
      issues.push(
        `Click GamePlayer in dist/${file} must not contain an initial iframe`,
      );
    }
  }

  if (
    loadMode === "eager" &&
    (playerFrames.length !== 1 || allFrames.length !== 1)
  ) {
    issues.push(
      `Eager game page dist/${file} must contain exactly one initial iframe inside its GamePlayer root; found ${allFrames.length} on the page and ${playerFrames.length} in the root`,
    );
  }

  allFrames.each((_index, element) => {
    const frame = $(element);
    const frameSource = frame.attr("src")?.trim();
    if (!frameSource) {
      issues.push(`Iframe in dist/${file} must contain a non-empty src`);
    } else {
      try {
        const frameUrl = validateEmbedUrl(frameSource, allowedGameOrigins);
        if (sourceUrl && frameUrl.href !== sourceUrl.href) {
          issues.push(
            `Iframe src in dist/${file} must equal its GamePlayer data-src`,
          );
        }
      } catch (error) {
        issues.push(
          `Iframe src in dist/${file} is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const expectedAttributes = title
      ? getGameFrameAttributes(title)
      : undefined;
    if (
      expectedAttributes &&
      frame.attr("title") !== expectedAttributes.title
    ) {
      issues.push(`Iframe in dist/${file} must contain the exact game title`);
    }
    if (frame.attr("allow") !== GAME_FRAME_ALLOW) {
      issues.push(
        `Iframe allow in dist/${file} must equal "${GAME_FRAME_ALLOW}"`,
      );
    }
    if (frame.attr("sandbox") !== GAME_FRAME_SANDBOX) {
      issues.push(
        `Iframe sandbox in dist/${file} must equal "${GAME_FRAME_SANDBOX}"`,
      );
    }
    if (frame.attr("referrerpolicy") !== GAME_FRAME_REFERRER_POLICY) {
      issues.push(
        `Iframe referrerpolicy in dist/${file} must equal "${GAME_FRAME_REFERRER_POLICY}"`,
      );
    }
    if (frame.attr("allowfullscreen") === undefined) {
      issues.push(`Iframe in dist/${file} must contain allowfullscreen`);
    }
    if (frame.attr("srcdoc") !== undefined) {
      issues.push(`Iframe in dist/${file} must not contain srcdoc`);
    }

    const sandboxTokens = new Set(
      (frame.attr("sandbox") ?? "")
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    );
    for (const token of FORBIDDEN_SANDBOX_TOKENS) {
      if (sandboxTokens.has(token)) {
        issues.push(`Iframe in dist/${file} contains forbidden ${token}`);
      }
    }

    const permissionTokens = new Set(
      (frame.attr("allow") ?? "")
        .toLocaleLowerCase()
        .split(";")
        .map((token) => token.trim().split(/\s+/)[0])
        .filter(Boolean),
    );
    for (const permission of FORBIDDEN_FRAME_PERMISSIONS) {
      if (permissionTokens.has(permission)) {
        issues.push(
          `Iframe in dist/${file} contains forbidden ${permission} permission`,
        );
      }
    }
  });
}

/**
 * @param {ReturnType<typeof createPage>} page
 * @param {string[]} issues
 * @param {string | undefined} siteOrigin
 * @param {Set<string>} outputPaths
 */
function validatePage(
  page,
  issues,
  siteOrigin,
  outputPaths,
  allowedGameOrigins,
) {
  const { $, file, route } = page;
  const isNotFound = route === "/404.html";

  const titles = $("title");
  if (titles.length !== 1 || !titles.first().text().trim()) {
    issues.push(
      `dist/${file} must contain exactly one non-empty title; found ${titles.length}`,
    );
  } else {
    page.title = titles.first().text().trim().replace(/\s+/g, " ");
    if (page.title.length > MAX_PAGE_TITLE_LENGTH) {
      issues.push(
        `dist/${file} title must not exceed ${MAX_PAGE_TITLE_LENGTH} characters`,
      );
    }
  }

  const headings = $("h1");
  if (headings.length !== 1 || !headings.first().text().trim()) {
    issues.push(
      `dist/${file} must contain exactly one non-empty H1; found ${headings.length}`,
    );
  }

  page.robots = readSingletonAttribute(
    issues,
    file,
    metaElements($, "name", "robots"),
    "robots metadata",
    "content",
  );
  if (isNotFound) {
    if (!page.robots?.toLocaleLowerCase().includes("noindex")) {
      issues.push("dist/404.html must contain noindex in its robots metadata");
    }
  } else if (page.robots?.toLocaleLowerCase().includes("noindex")) {
    issues.push(`Indexable page dist/${file} must not be marked noindex`);
  }

  const canonicals = canonicalElements($);
  if (!isNotFound || canonicals.length > 0) {
    page.canonical = readSingletonAttribute(
      issues,
      file,
      canonicals,
      "canonical",
      "href",
    );
  }
  if (page.canonical) {
    page.canonicalUrl = readHttpsUrl(
      issues,
      `dist/${file} canonical`,
      page.canonical,
      siteOrigin ? { origin: siteOrigin } : {},
    );
    if (page.canonicalUrl) {
      if (
        route.endsWith("/") &&
        route !== "/" &&
        !page.canonicalUrl.pathname.endsWith("/")
      ) {
        issues.push(`dist/${file} canonical must use a trailing slash`);
      }
      if (
        page.canonicalUrl.pathname !== route ||
        page.canonicalUrl.search ||
        page.canonicalUrl.hash
      ) {
        issues.push(
          `dist/${file} canonical route must match generated route ${route}`,
        );
      }
    }
  }

  if (!isNotFound) {
    readSingletonAttribute(
      issues,
      file,
      metaElements($, "name", "description"),
      "description",
      "content",
    );

    const metadata = new Map();
    for (const property of REQUIRED_OPEN_GRAPH_FIELDS) {
      metadata.set(
        property,
        readSingletonAttribute(
          issues,
          file,
          metaElements($, "property", property),
          property,
          "content",
        ),
      );
    }
    for (const name of REQUIRED_TWITTER_FIELDS) {
      metadata.set(
        name,
        readSingletonAttribute(
          issues,
          file,
          metaElements($, "name", name),
          name,
          "content",
        ),
      );
    }

    const openGraphUrl = metadata.get("og:url");
    if (openGraphUrl) {
      const url = readHttpsUrl(issues, `dist/${file} og:url`, openGraphUrl, {
        ...(siteOrigin ? { origin: siteOrigin } : {}),
      });
      if (url && page.canonicalUrl && url.href !== page.canonicalUrl.href) {
        issues.push(`dist/${file} og:url must equal its canonical URL`);
      }
    }
    for (const imageField of ["og:image", "twitter:image"]) {
      const image = metadata.get(imageField);
      if (!image) continue;
      const imageUrl = readHttpsUrl(
        issues,
        `dist/${file} ${imageField}`,
        image,
        siteOrigin ? { origin: siteOrigin } : {},
      );
      if (
        imageUrl &&
        imageUrl.origin === siteOrigin &&
        !outputPaths.has(imageUrl.pathname)
      ) {
        issues.push(
          `dist/${file} ${imageField} target is missing: ${imageUrl.pathname}`,
        );
      }
    }
  }

  const jsonLdScripts = $("script").filter((_index, element) => {
    return (
      ($(element).attr("type") ?? "").trim().toLocaleLowerCase() ===
      "application/ld+json"
    );
  });
  jsonLdScripts.each((index, element) => {
    const raw = $(element).html() ?? "";
    if (raw.includes("<")) {
      issues.push(
        `dist/${file} contains unsafe JSON-LD literal < in script ${index + 1}`,
      );
    }

    let value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      issues.push(
        `dist/${file} contains malformed JSON-LD in script ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    collectSchemaTypes(value, page.schemaTypes);
    collectSchemaObjects(value, page.schemaObjects);
    validateJsonLdValue(
      value,
      undefined,
      `$[${index}]`,
      siteOrigin,
      issues,
      file,
      outputPaths,
    );
  });

  const requiredSchemaTypes =
    route === "/"
      ? ["WebSite", "ItemList"]
      : /^\/games\/[^/]+\/$/.test(route)
        ? ["VideoGame", "BreadcrumbList"]
        : /^\/category\/[^/]+\/$/.test(route)
          ? ["CollectionPage", "ItemList", "BreadcrumbList"]
          : [];
  for (const schemaType of requiredSchemaTypes) {
    if (!page.schemaTypes.has(schemaType)) {
      issues.push(`dist/${file} must contain ${schemaType} schema`);
    }
  }

  const primarySchemaType =
    route === "/"
      ? "WebSite"
      : /^\/games\/[^/]+\/$/.test(route)
        ? "VideoGame"
        : /^\/category\/[^/]+\/$/.test(route)
          ? "CollectionPage"
          : undefined;
  if (primarySchemaType && page.canonicalUrl) {
    const primarySchemas = page.schemaObjects.filter((schema) => {
      const type = schema["@type"];
      return (
        type === primarySchemaType ||
        (Array.isArray(type) && type.includes(primarySchemaType))
      );
    });
    if (primarySchemas.length === 1) {
      if (primarySchemas[0]?.url !== page.canonicalUrl.href) {
        issues.push(
          `dist/${file} ${primarySchemaType} schema URL must equal page canonical ${page.canonicalUrl.href}`,
        );
      }
    } else if (primarySchemas.length > 1) {
      issues.push(
        `dist/${file} must contain exactly one primary ${primarySchemaType} schema`,
      );
    }
  }

  if (/^\/games\/[^/]+\/$/.test(route)) {
    validateGamePlayer(page, issues, siteOrigin, allowedGameOrigins);
    if (!$(".game-copy .prose").text().trim()) {
      issues.push(`Game page dist/${file} must contain game body text`);
    }
    const baseUrl = siteOrigin
      ? new URL(route, `${siteOrigin}/`).href
      : undefined;
    const hasCategoryLink = $(".game-info-strip a[href]")
      .toArray()
      .some((element) => {
        if (!baseUrl || !siteOrigin) return false;
        try {
          return /^\/category\/[^/]+\/$/.test(
            internalLinkPath(
              $(element).attr("href") ?? "",
              baseUrl,
              siteOrigin,
            ) ?? "",
          );
        } catch {
          return false;
        }
      });
    if (!hasCategoryLink) {
      issues.push(`Game page dist/${file} must contain a category link`);
    }
  }
}

/**
 * @param {ReturnType<typeof createPage>[]} pages
 * @param {string[]} issues
 * @param {string | undefined} siteOrigin
 * @param {Set<string>} outputPaths
 */
function validateInternalLinks(pages, issues, siteOrigin, outputPaths) {
  if (!siteOrigin) return;

  for (const page of pages) {
    const baseUrl = new URL(page.route, `${siteOrigin}/`).href;
    page.$("a[href]").each((_index, element) => {
      const href = page.$(element).attr("href") ?? "";
      let target;
      try {
        target = internalLinkPath(href, baseUrl, siteOrigin);
      } catch {
        issues.push(
          `dist/${page.file} contains an invalid internal link: ${href}`,
        );
        return;
      }
      if (target && !outputPaths.has(target)) {
        issues.push(
          `dist/${page.file} internal link target is missing: ${target}`,
        );
      }
    });
  }
}

/** @param {string} xml */
function xmlLocations(xml) {
  const $ = load(xml, { xml: true });
  return $("loc")
    .toArray()
    .map((element) => $(element).text().trim())
    .filter(Boolean);
}

/**
 * @param {string} distDirectory
 * @param {Set<string>} outputFiles
 * @param {string[]} issues
 * @param {string | undefined} siteOrigin
 * @param {Set<string>} indexableCanonicals
 * @param {Set<string>} excludedRoutes
 */
async function validateSitemaps(
  distDirectory,
  outputFiles,
  issues,
  siteOrigin,
  indexableCanonicals,
  excludedRoutes,
) {
  if (!outputFiles.has("sitemap-index.xml")) {
    issues.push("dist/sitemap-index.xml is missing");
    return [];
  }

  const indexXml = await readBuiltFile(distDirectory, "sitemap-index.xml");
  const childLocations = xmlLocations(indexXml);
  if (childLocations.length === 0) {
    issues.push(
      "dist/sitemap-index.xml must reference at least one child Sitemap",
    );
  }

  const childUrls = new Set();
  const sitemapUrls = [];
  for (const location of childLocations) {
    const childUrl = readHttpsUrl(
      issues,
      "Sitemap index child URL",
      location,
      siteOrigin ? { origin: siteOrigin } : {},
    );
    if (!childUrl) continue;
    if (childUrls.has(childUrl.href)) {
      issues.push(
        `Sitemap index contains duplicate child URL: ${childUrl.href}`,
      );
      continue;
    }
    childUrls.add(childUrl.href);

    let childFile;
    try {
      childFile = decodeURIComponent(childUrl.pathname).replace(/^\/+/, "");
    } catch {
      issues.push(`Sitemap child URL has invalid encoding: ${childUrl.href}`);
      continue;
    }
    if (
      !childFile ||
      childFile.split("/").some((segment) => segment === "..") ||
      !outputFiles.has(childFile)
    ) {
      issues.push(`dist/${childFile || childUrl.pathname} is missing`);
      continue;
    }
    sitemapUrls.push(
      ...xmlLocations(await readBuiltFile(distDirectory, childFile)),
    );
  }

  const normalizedUrls = new Set();
  for (const location of sitemapUrls) {
    const url = readHttpsUrl(
      issues,
      "Sitemap page URL",
      location,
      siteOrigin ? { origin: siteOrigin } : {},
    );
    if (!url) continue;
    if (url.search || url.hash) {
      issues.push(
        `Sitemap page URL must not contain query or hash: ${url.href}`,
      );
    }
    if (url.pathname !== "/" && !url.pathname.endsWith("/")) {
      issues.push(`Sitemap page URL must use a trailing slash: ${url.href}`);
    }
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      issues.push(`Sitemap must not include admin URL: ${url.href}`);
    }
    if (url.pathname === "/404.html") {
      issues.push(`Sitemap must not include 404 URL: ${url.href}`);
    }
    if (excludedRoutes.has(url.pathname)) {
      issues.push(
        `Sitemap must not include unpublished route: ${url.pathname}`,
      );
    }
    if (normalizedUrls.has(url.href)) {
      issues.push(`Sitemap contains duplicate URL: ${url.href}`);
    }
    normalizedUrls.add(url.href);
  }

  for (const url of normalizedUrls) {
    if (!indexableCanonicals.has(url)) {
      issues.push(
        `Sitemap URL has no matching generated indexable canonical: ${url}`,
      );
    }
  }
  for (const canonical of indexableCanonicals) {
    if (!normalizedUrls.has(canonical)) {
      issues.push(`Indexable canonical is missing from Sitemap: ${canonical}`);
    }
  }
  return [...normalizedUrls].sort();
}

/**
 * Discover draft content routes without loading Astro's content runtime.
 *
 * @param {string} projectRoot
 */
export async function discoverUnpublishedRoutes(projectRoot) {
  /** @type {string[]} */
  const routes = [];

  for (const [collection, routePrefix] of [
    ["games", "/games/"],
    ["categories", "/category/"],
  ]) {
    const contentRoot = resolve(projectRoot, "src", "content", collection);
    let files;
    try {
      files = (await listOutputFiles(contentRoot)).filter((file) =>
        /\.(?:md|mdx)$/i.test(file),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "dist directory is missing"
      ) {
        continue;
      }
      throw error;
    }

    for (const file of files) {
      const source = await readBuiltFile(contentRoot, file);
      const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1];
      if (
        !frontmatter ||
        !/^\s*status\s*:\s*["']?draft["']?\s*$/im.test(frontmatter)
      ) {
        continue;
      }

      routes.push(`${routePrefix}${file.replace(/\.(?:md|mdx)$/i, "")}/`);
    }
  }

  return routes.sort();
}

/**
 * @param {string} distDirectory
 * @param {Set<string>} outputFiles
 * @param {string[]} issues
 * @param {string | undefined} siteOrigin
 */
async function validateRobots(distDirectory, outputFiles, issues, siteOrigin) {
  if (!outputFiles.has("robots.txt")) {
    issues.push("dist/robots.txt is missing");
    return;
  }

  const robots = await readBuiltFile(distDirectory, "robots.txt");
  const lines = robots
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!lines.some((line) => /^User-agent\s*:\s*\*$/i.test(line))) {
    issues.push("dist/robots.txt must contain User-agent: *");
  }
  if (!lines.some((line) => /^Allow\s*:\s*\/$/i.test(line))) {
    issues.push("dist/robots.txt must contain Allow: /");
  }
  if (!lines.some((line) => /^Disallow\s*:\s*\/admin\/$/i.test(line))) {
    issues.push("dist/robots.txt must contain Disallow: /admin/");
  }

  const sitemapLines = lines.flatMap((line) => {
    const match = line.match(/^Sitemap\s*:\s*(.+)$/i);
    return match?.[1] ? [match[1].trim()] : [];
  });
  if (sitemapLines.length !== 1) {
    issues.push(
      `dist/robots.txt must contain exactly one Sitemap URL; found ${sitemapLines.length}`,
    );
    return;
  }
  if (siteOrigin) {
    const expected = `${siteOrigin}/sitemap-index.xml`;
    if (sitemapLines[0] !== expected) {
      issues.push(
        `dist/robots.txt Sitemap URL must equal ${expected}; found ${sitemapLines[0]}`,
      );
    }
  }
}

/**
 * @param {string} distDirectory
 * @param {{ expectedSiteOrigin?: string, allowedGameOrigins?: readonly URL[], excludedRoutes?: readonly string[] }} [options]
 */
export async function verifyDist(distDirectory, options = {}) {
  const outputFileList = await listOutputFiles(distDirectory);
  const outputFiles = new Set(outputFileList);
  if (!outputFiles.has("index.html")) {
    throw new Error("dist/index.html is missing");
  }
  if (!outputFiles.has("404.html")) {
    throw new Error("dist/404.html is missing");
  }

  const htmlFiles = outputFileList.filter((file) =>
    file.toLocaleLowerCase().endsWith(".html"),
  );
  const pages = await Promise.all(
    htmlFiles.map(async (file) =>
      createPage(file, await readBuiltFile(distDirectory, file)),
    ),
  );
  const rootPage = pages.find((page) => page.route === "/");

  let builtSiteOrigin;
  if (rootPage) {
    const rootCanonicals = canonicalElements(rootPage.$);
    if (rootCanonicals.length === 1) {
      const value = rootCanonicals.attr("href")?.trim();
      if (value) {
        try {
          builtSiteOrigin = new URL(value).origin;
        } catch {
          // validatePage records the actionable canonical error.
        }
      }
    }
  }

  const outputPaths = new Set(
    outputFileList.map((file) =>
      file.toLocaleLowerCase().endsWith(".html")
        ? htmlFileToRoute(file)
        : `/${file}`,
    ),
  );
  const issues = [];
  let expectedSiteOrigin;
  if (options.expectedSiteOrigin) {
    const expectedUrl = readHttpsUrl(
      issues,
      "Configured site origin",
      options.expectedSiteOrigin,
    );
    if (
      expectedUrl &&
      (expectedUrl.pathname !== "/" || expectedUrl.search || expectedUrl.hash)
    ) {
      issues.push(
        "Configured site origin must not contain a path, query, or hash",
      );
    }
    expectedSiteOrigin = expectedUrl?.origin;
  }
  if (
    expectedSiteOrigin &&
    builtSiteOrigin &&
    builtSiteOrigin !== expectedSiteOrigin
  ) {
    issues.push(
      `Built site origin ${builtSiteOrigin} must match configured site origin ${expectedSiteOrigin}`,
    );
  }
  const siteOrigin = expectedSiteOrigin ?? builtSiteOrigin;
  const allowedGameOrigins =
    options.allowedGameOrigins ?? parseAllowedGameOrigins(DEFAULT_GAME_ORIGIN);
  const excludedRoutes = new Set(options.excludedRoutes ?? []);
  for (const page of pages) {
    validatePage(page, issues, siteOrigin, outputPaths, allowedGameOrigins);
    if (excludedRoutes.has(page.route)) {
      issues.push(
        `Generated output must not include unpublished route: ${page.route}`,
      );
    }
  }

  const titles = new Map();
  for (const page of pages) {
    if (!page.title) continue;
    const normalizedTitle = page.title.toLocaleLowerCase();
    const priorFile = titles.get(normalizedTitle);
    if (priorFile) {
      issues.push(
        `Page title must be unique; duplicate title in dist/${priorFile} and dist/${page.file}: ${page.title}`,
      );
    } else {
      titles.set(normalizedTitle, page.file);
    }
  }

  validateInternalLinks(pages, issues, siteOrigin, outputPaths);
  const indexableCanonicals = new Set(
    pages.flatMap((page) => {
      if (page.route === "/404.html" || !page.canonicalUrl) return [];
      return [page.canonicalUrl.href];
    }),
  );
  await validateRobots(distDirectory, outputFiles, issues, siteOrigin);
  const sitemapUrls = await validateSitemaps(
    distDirectory,
    outputFiles,
    issues,
    siteOrigin,
    indexableCanonicals,
    excludedRoutes,
  );

  if (issues.length > 0) {
    throw new Error(
      `dist verification failed with ${issues.length} issue(s):\n${issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    );
  }

  return {
    checkedFiles: htmlFiles,
    indexablePages: indexableCanonicals.size,
    sitemapUrls,
    siteOrigin,
  };
}

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const environment = loadEnv(
    process.env.NODE_ENV ?? "production",
    projectRoot,
    "PUBLIC_",
  );
  const expectedSiteOrigin = resolveSiteOrigin(
    environment.PUBLIC_SITE_URL,
  ).origin;
  const allowedGameOrigins = parseAllowedGameOrigins(
    environment.PUBLIC_GAME_ORIGINS ?? DEFAULT_GAME_ORIGIN,
  );

  discoverUnpublishedRoutes(projectRoot)
    .then((excludedRoutes) =>
      verifyDist(resolve(projectRoot, "dist"), {
        expectedSiteOrigin,
        allowedGameOrigins,
        excludedRoutes,
      }),
    )
    .then(({ checkedFiles, indexablePages, sitemapUrls }) => {
      console.log(
        `Verified ${checkedFiles.length} static HTML files, ${indexablePages} indexable pages, ${sitemapUrls.length} Sitemap URLs, robots.txt, metadata, links, JSON-LD, and GamePlayer output.`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
