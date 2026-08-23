import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { load } from "cheerio";

import {
  formatProductionIssues,
  readProductionOrigins,
  validateProductionOrigins,
  validateProductionRuntime,
} from "./production-config.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const scope = valueAfter("--scope") ?? "all";
const projectRoot = resolve(valueAfter("--project-root") ?? ".");
const configPath = resolve(
  valueAfter("--config") ??
    resolve(projectRoot, "config/production-origins.json"),
);

const execFileAsync = promisify(execFile);
const issue = (code, field, message) => ({ code, field, message });
const productionPreflight =
  "npm run format:check && npm run check && npm run test && npm run build:production && npm run verify:dist && npm run test:e2e && npm run verify:production-config";
const advertisingSignatures = [
  "adsbygoogle",
  "googlesyndication.com",
  "doubleclick.net",
  "adsterra",
];

const trackedFiles = async () => {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", projectRoot, "ls-files", "-z"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout.split("\0").filter(Boolean);
};

const isTextSource = (path) =>
  [".astro", ".css", ".html", ".js", ".mjs", ".ts"].includes(
    extname(path).toLowerCase(),
  );

const isSecretConfiguration = (path) =>
  /(?:^|\/)(?:wrangler\.jsonc|config\.ya?ml|[^/]*\.toml|\.env[^/]*|[^/]*\.jsonc?)$/i.test(
    path,
  );

const validateRootDeployScripts = async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, "package.json"), "utf8"),
  );
  const scripts = packageJson?.scripts ?? {};
  const expectedScripts = {
    "format:check": "prettier --check .",
    check: "astro check",
    test: "vitest run --no-file-parallelism --exclude=tests/e2e/**",
    "build:production": "astro build --mode production",
    "verify:dist": "node scripts/verify-dist.mjs",
    "test:e2e": "playwright test",
    "verify:production-config": "node scripts/verify-production-config.mjs",
    "deploy:dry": "npm run deploy:production:dry",
    deploy: "npm run deploy:production",
    "deploy:production:dry": `${productionPreflight} && npx wrangler deploy --dry-run`,
    "deploy:production": `${productionPreflight} && npx wrangler deploy --dry-run && npx wrangler deploy`,
  };
  const issues = [];

  for (const [name, expected] of Object.entries(expectedScripts)) {
    const command = String(scripts[name] ?? "");
    if (command !== expected) {
      issues.push(
        issue(
          "ROOT_DEPLOY_PIPELINE",
          `package.json#scripts.${name}`,
          `${name} must exactly match the approved validation-first production pipeline`,
        ),
      );
    }
  }

  return issues;
};

const validateWorkersPreviewHeaders = async () => {
  const path = resolve(projectRoot, "public/_headers");
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    return [
      issue(
        "WORKERS_DEV_NOINDEX",
        "public/_headers",
        "public/_headers must protect workers.dev previews with noindex",
      ),
    ];
  }

  const lines = source.split(/\r?\n/);
  const routeIndex = lines.findIndex(
    (line) => line.trim() === "https://:version.:subdomain.workers.dev/*",
  );
  if (routeIndex === -1) {
    return [
      issue(
        "WORKERS_DEV_NOINDEX",
        "public/_headers",
        "workers.dev preview route must be declared",
      ),
    ];
  }

  const headers = [];
  for (let index = routeIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) break;
    headers.push(line.trim());
  }
  const robotsHeader = headers.find((line) => /^X-Robots-Tag\s*:/i.test(line));
  if (!robotsHeader || !/\bnoindex\b/i.test(robotsHeader)) {
    return [
      issue(
        "WORKERS_DEV_NOINDEX",
        "public/_headers",
        "workers.dev previews must send X-Robots-Tag: noindex",
      ),
    ];
  }
  return [];
};

const validateAdDefaults = async () => {
  const path = resolve(projectRoot, "src/config/ads.ts");
  try {
    const moduleUrl = `${pathToFileURL(path).href}?production-config=${Date.now()}`;
    const adsModule = await import(moduleUrl);
    const slotIds = adsModule.AD_SLOT_IDS;
    const config = adsModule.createAdsConfig?.({});
    const hasEnabledSlot =
      !Array.isArray(slotIds) ||
      slotIds.length === 0 ||
      slotIds.some((slot) => config?.slots?.[slot] !== false);
    if (config?.mode !== "disabled" || hasEnabledSlot) {
      return [
        issue(
          "AD_SLOTS_DEFAULT_ENABLED",
          "src/config/ads.ts",
          "every approved advertising slot must default to disabled",
        ),
      ];
    }
    return [];
  } catch {
    return [
      issue(
        "AD_CONFIG_INVALID",
        "src/config/ads.ts",
        "advertising defaults could not be evaluated",
      ),
    ];
  }
};

const listActualFiles = async (roots) => {
  const files = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      if (entry.isFile()) files.push(path);
    }
  };
  for (const root of roots) await visit(resolve(projectRoot, root));
  return files;
};

const readOptionalFile = async (path) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
};

const canonicalElements = ($) =>
  $("link").filter((_index, element) =>
    ($(element).attr("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .includes("canonical"),
  );

const discoverDraftRoutes = async () => {
  const routes = new Set();
  for (const [root, prefix] of [
    ["src/content/games", "/games/"],
    ["src/content/categories", "/category/"],
  ]) {
    const absoluteRoot = resolve(projectRoot, root);
    const files = await listActualFiles([root]);
    for (const path of files) {
      if (!/\.(?:md|mdx)$/i.test(path)) continue;
      const source = await readFile(path, "utf8");
      if (!/^\s*status\s*:\s*["']?draft["']?\s*$/im.test(source)) continue;
      const id = relative(absoluteRoot, path)
        .replaceAll("\\", "/")
        .replace(/\.(?:md|mdx)$/i, "");
      routes.add(`${prefix}${id}/`);
    }
  }
  return routes;
};

const validateProductionOutput = async (runtime) => {
  const issues = [];
  const distFiles = await listActualFiles(["dist"]);
  const htmlFiles = distFiles.filter((path) =>
    path.toLowerCase().endsWith(".html"),
  );
  if (htmlFiles.length === 0) {
    issues.push(
      issue(
        "DIST_OUTPUT_MISSING",
        "dist",
        "production output must be built before configuration verification",
      ),
    );
    return issues;
  }

  const builtSource = (
    await Promise.all(
      distFiles.filter(isTextSource).map((path) => readFile(path, "utf8")),
    )
  )
    .join("\n")
    .toLowerCase()
    .replaceAll(" ", "");
  if (
    advertisingSignatures.some((signature) => builtSource.includes(signature))
  ) {
    issues.push(
      issue(
        "UNAPPROVED_AD_SCRIPT",
        "dist",
        "built public output must not load an advertising vendor",
      ),
    );
  }

  for (const path of htmlFiles) {
    const $ = load(await readFile(path, "utf8"));
    const canonicals = canonicalElements($);
    if (canonicals.length !== 1) continue;
    const value = canonicals.attr("href")?.trim();
    try {
      if (!value || new URL(value).origin !== runtime.siteOrigin) {
        issues.push(
          issue(
            "DIST_CANONICAL_ORIGIN",
            relative(projectRoot, path).replaceAll("\\", "/"),
            "built canonical Origin must equal PUBLIC_SITE_URL",
          ),
        );
      }
    } catch {
      issues.push(
        issue(
          "DIST_CANONICAL_ORIGIN",
          relative(projectRoot, path).replaceAll("\\", "/"),
          "built canonical must be an absolute production URL",
        ),
      );
    }
  }

  const robotsPath = resolve(projectRoot, "dist/robots.txt");
  const robots = await readOptionalFile(robotsPath);
  const expectedSitemap = `${runtime.siteOrigin}/sitemap-index.xml`;
  const sitemapLines = (robots ?? "")
    .split(/\r?\n/)
    .flatMap((line) => line.match(/^\s*Sitemap\s*:\s*(.+)\s*$/i)?.[1] ?? []);
  if (sitemapLines.length !== 1 || sitemapLines[0] !== expectedSitemap) {
    issues.push(
      issue(
        "ROBOTS_SITEMAP_ORIGIN",
        "dist/robots.txt",
        "robots Sitemap must use PUBLIC_SITE_URL",
      ),
    );
  }

  const draftRoutes = await discoverDraftRoutes();
  for (const path of distFiles.filter((file) =>
    /(?:^|[\\/])sitemap[^\\/]*\.xml$/i.test(file),
  )) {
    const $ = load(await readFile(path, "utf8"), { xml: true });
    for (const element of $("loc").toArray()) {
      const value = $(element).text().trim();
      let url;
      try {
        url = new URL(value);
      } catch {
        continue;
      }
      if (url.origin !== runtime.siteOrigin) {
        issues.push(
          issue(
            "SITEMAP_ORIGIN",
            relative(projectRoot, path).replaceAll("\\", "/"),
            "Sitemap URLs must use PUBLIC_SITE_URL",
          ),
        );
      }
      const forbidden =
        url.pathname === "/404.html" ||
        url.pathname === "/admin" ||
        url.pathname.startsWith("/admin/") ||
        draftRoutes.has(url.pathname);
      if (forbidden) {
        issues.push(
          issue(
            "SITEMAP_FORBIDDEN_ROUTE",
            relative(projectRoot, path).replaceAll("\\", "/"),
            "Sitemap must not contain draft, Admin, or 404 routes",
          ),
        );
      }
    }
  }

  return issues;
};

const validateRepositoryBoundary = async () => {
  const issues = [];
  const tracked = await trackedFiles();
  const actualFiles = await listActualFiles(["public", "src"]);
  const actualRelativeFiles = actualFiles.map((path) =>
    relative(projectRoot, path).replaceAll("\\", "/"),
  );
  if (
    actualRelativeFiles.some(
      (path) =>
        path.startsWith("public/admin/") ||
        /^src\/pages\/admin(?:\.(?:astro|html|md|mdx|js|mjs|ts)|\/)/i.test(
          path,
        ),
    )
  ) {
    issues.push(
      issue(
        "PUBLIC_ADMIN_ROUTE",
        "public/admin",
        "CMS Admin must not be served from the public site",
      ),
    );
  }

  const publicSiteFiles = actualFiles.filter(isTextSource);
  const publicSiteSource = (
    await Promise.all(publicSiteFiles.map((path) => readFile(path, "utf8")))
  )
    .join("\n")
    .toLowerCase()
    .replaceAll(" ", "");
  if (
    publicSiteSource.includes("decap-cms") ||
    publicSiteSource.includes("unpkg.com/decap")
  ) {
    issues.push(
      issue(
        "PUBLIC_DECAP",
        "public/src",
        "Decap must not appear in the public site",
      ),
    );
  }

  if (
    advertisingSignatures.some((signature) =>
      publicSiteSource.includes(signature),
    )
  ) {
    issues.push(
      issue(
        "UNAPPROVED_AD_SCRIPT",
        "public/src",
        "the public site must not load an advertising vendor",
      ),
    );
  }

  if (tracked.some((path) => /(?:^|\/)\.dev\.vars(?:$|\.)/.test(path))) {
    issues.push(
      issue(
        "TRACKED_DEV_VARS",
        ".dev.vars",
        "Development Secret files must not be tracked",
      ),
    );
  }

  const configurationFiles = tracked.filter(isSecretConfiguration);
  const secretAssignment = /["']?GITHUB_OAUTH_(?:ID|SECRET)["']?\s*(?::|=)/;
  for (const path of configurationFiles) {
    const source = await readFile(resolve(projectRoot, path), "utf8");
    if (secretAssignment.test(source)) {
      issues.push(
        issue(
          "TRACKED_SECRET",
          path,
          "OAuth Client ID and Secret must not be assigned in tracked config",
        ),
      );
    }
  }

  issues.push(...(await validateRootDeployScripts()));
  issues.push(...(await validateWorkersPreviewHeaders()));
  issues.push(...(await validateAdDefaults()));

  return issues;
};

if (scope !== "origins" && scope !== "all") {
  console.error(`UNKNOWN_SCOPE ${scope}`);
  process.exitCode = 1;
} else {
  try {
    const input = await readProductionOrigins(configPath);
    const result = validateProductionOrigins(input);
    const issues = [...result.issues];
    if (scope === "all") {
      issues.push(...(await validateRepositoryBoundary()));
      if (result.issues.length === 0) {
        const runtime = validateProductionRuntime(process.env, result.origins);
        issues.push(...runtime.issues);
        if (runtime.issues.length === 0) {
          issues.push(...(await validateProductionOutput(runtime)));
        }
      }
    }
    if (issues.length > 0) {
      console.error(formatProductionIssues(issues));
      process.exitCode = 1;
    } else if (scope === "all") {
      console.log("Repository production configuration verified.");
    } else {
      console.log(`Production Origins verified: ${configPath}`);
    }
  } catch (error) {
    console.error(
      `PRODUCTION_CONFIG_READ_FAILED ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
