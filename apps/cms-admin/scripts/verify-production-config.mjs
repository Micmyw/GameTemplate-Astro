import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Script } from "node:vm";

import { load } from "cheerio";
import { parse } from "yaml";

import {
  formatProductionIssues,
  readProductionOrigins,
  validateProductionOrigins,
} from "../../../scripts/production-config.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const defaultProjectRoot = resolve(import.meta.dirname, "../../..");
const projectRoot = resolve(valueAfter("--project-root") ?? defaultProjectRoot);
const configPath = resolve(
  valueAfter("--config") ??
    resolve(projectRoot, "config/production-origins.json"),
);
const publicRoot = resolve(projectRoot, "apps/cms-admin/public");

const issue = (code, field, message) => ({ code, field, message });
const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const APPROVED_DECAP_SRC =
  "https://unpkg.com/decap-cms@3.15.1/dist/decap-cms.js";
const APPROVED_DECAP_INTEGRITY =
  "sha384-in6eHztHveqQ7uMZ1fDaKlDmacQLFuLH2wWrFTiymyuS8zQ5bixwL8U3AeRi8h/L";
const DENIED_STATUS =
  "CMS authentication is not configured for this deployment.";
const EXPECTED_ADMIN_DEPLOY_SCRIPTS = {
  "deploy:production:dry":
    "npm run format:check && npm run test:headers && npm run verify:production-config && wrangler deploy --dry-run --env production",
  "deploy:production":
    "npm run format:check && npm run test:headers && npm run verify:production-config && wrangler deploy --env production",
};

const listTextFiles = async (directory) => {
  const paths = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      if (
        entry.isFile() &&
        [".css", ".html", ".js", ".svg", ".yml", ".yaml"].includes(
          extname(path).toLowerCase(),
        )
      ) {
        paths.push(path);
      }
    }
  };
  await visit(directory);
  return paths;
};

const runLoader = (source, dataset, hostname) => {
  const appended = [];
  const status = {
    removed: false,
    textContent: "Loading",
    remove() {
      this.removed = true;
    },
  };
  const document = {
    body: { dataset: { ...dataset } },
    getElementById(id) {
      return id === "cms-status" ? status : null;
    },
    createElement(tagName) {
      if (tagName !== "script") {
        throw new Error(`Unexpected dynamic element ${tagName}`);
      }
      return {
        dataset: {},
        listeners: new Map(),
        addEventListener(name, listener) {
          this.listeners.set(name, listener);
        },
      };
    },
    head: {
      append(node) {
        appended.push(node);
      },
    },
  };
  const window = {
    location: { hostname },
    CMS: { registerPreviewStyle() {} },
  };

  new Script(source, {
    filename: "cms-admin-inline-loader.js",
  }).runInNewContext({ document, Set, URL, window }, { timeout: 1_000 });
  for (const client of appended) client.listeners.get("load")?.();

  return { appended, status };
};

const validateAdminLoader = (adminHtml, origins) => {
  const issues = [];
  const $ = load(adminHtml);
  const body = $("body");
  const expectedHostname = new URL(origins.CMS_ADMIN_ORIGIN).hostname;
  const dataset = {
    cmsIntegrity: body.attr("data-cms-integrity"),
    cmsProductionHostname: body.attr("data-cms-production-hostname"),
    cmsSrc: body.attr("data-cms-src"),
  };

  if (body.length !== 1 || dataset.cmsProductionHostname !== expectedHostname) {
    issues.push(
      issue(
        "ADMIN_HOSTNAME",
        "index.html",
        "Admin production hostname must be a real body attribute matching CMS_ADMIN_ORIGIN",
      ),
    );
  }
  if (
    dataset.cmsSrc !== APPROVED_DECAP_SRC ||
    dataset.cmsIntegrity !== APPROVED_DECAP_INTEGRITY
  ) {
    issues.push(
      issue(
        "ADMIN_DECAP_CLIENT",
        "index.html",
        "Decap must use the exact approved URL and SRI digest",
      ),
    );
  }

  const externalScripts = $("script[src]");
  const inlineScripts = $("script:not([src])");
  if (externalScripts.length !== 0 || inlineScripts.length !== 1) {
    issues.push(
      issue(
        "ADMIN_THIRD_PARTY_CODE",
        "index.html",
        "CMS Admin must contain one inline allowlist loader and no script tags with src",
      ),
    );
  }

  const loaderSource = inlineScripts.first().text();
  const dynamicScriptCreations =
    loaderSource.match(/document\.createElement\s*\(\s*["']script["']\s*\)/g) ??
    [];
  if (
    dynamicScriptCreations.length !== 1 ||
    /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b|\bimport\s*\(|\bnew\s+Image\s*\(/.test(
      loaderSource,
    )
  ) {
    issues.push(
      issue(
        "ADMIN_THIRD_PARTY_CODE",
        "index.html",
        "CMS Admin loader may create only the approved Decap script and no telemetry transport",
      ),
    );
  }

  if (
    issues.some(({ code }) =>
      [
        "ADMIN_HOSTNAME",
        "ADMIN_DECAP_CLIENT",
        "ADMIN_THIRD_PARTY_CODE",
      ].includes(code),
    )
  ) {
    return issues;
  }

  try {
    for (const hostname of [
      "localhost",
      "127.0.0.1",
      "::1",
      expectedHostname,
    ]) {
      const result = runLoader(loaderSource, dataset, hostname);
      if (result.appended.length !== 1) {
        throw new Error(`approved hostname ${hostname} did not load once`);
      }
      const [client] = result.appended;
      if (
        client.src !== APPROVED_DECAP_SRC ||
        client.integrity !== APPROVED_DECAP_INTEGRITY ||
        client.crossOrigin !== "anonymous" ||
        client.dataset.decapClient !== ""
      ) {
        issues.push(
          issue(
            "ADMIN_DECAP_CLIENT",
            "index.html",
            "Runtime loader must append only the exact approved Decap client",
          ),
        );
        break;
      }
    }

    for (const hostname of [
      `sub.${expectedHostname}`,
      `${expectedHostname}.attacker.test`,
      "cms.example.test",
      "attacker.test",
    ]) {
      const result = runLoader(loaderSource, dataset, hostname);
      if (
        result.appended.length !== 0 ||
        result.status.textContent !== DENIED_STATUS
      ) {
        throw new Error(`unapproved hostname ${hostname} loaded the client`);
      }
    }
  } catch (error) {
    issues.push(
      issue(
        "ADMIN_HOST_MATCHING",
        "index.html",
        `Admin loader behavior is not exact-host only: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  return issues;
};

const validateAdminConfiguration = async (origins) => {
  const issues = [];
  const [configSource, adminHtml, headersSource, packageSource, publicFiles] =
    await Promise.all([
      readFile(resolve(publicRoot, "config.yml"), "utf8"),
      readFile(resolve(publicRoot, "index.html"), "utf8"),
      readFile(resolve(publicRoot, "_headers"), "utf8"),
      readFile(resolve(projectRoot, "apps/cms-admin/package.json"), "utf8"),
      listTextFiles(publicRoot),
    ]);
  const cmsConfig = asRecord(parse(configSource));
  const backend = asRecord(cmsConfig.backend);

  if (backend.base_url !== origins.CMS_AUTH_ORIGIN) {
    issues.push(
      issue(
        "ADMIN_BASE_URL",
        "backend.base_url",
        "CMS backend base_url must equal CMS_AUTH_ORIGIN",
      ),
    );
  }
  if (backend.auth_endpoint !== "/auth") {
    issues.push(
      issue(
        "ADMIN_AUTH_ENDPOINT",
        "backend.auth_endpoint",
        "CMS backend auth_endpoint must be /auth",
      ),
    );
  }
  if (
    !cmsConfig.local_backend ||
    typeof cmsConfig.local_backend !== "object" ||
    Array.isArray(cmsConfig.local_backend)
  ) {
    issues.push(
      issue(
        "ADMIN_LOCAL_BACKEND",
        "local_backend",
        "CMS local_backend must remain configured",
      ),
    );
  }

  const scripts = asRecord(asRecord(JSON.parse(packageSource)).scripts);
  for (const [name, expected] of Object.entries(
    EXPECTED_ADMIN_DEPLOY_SCRIPTS,
  )) {
    if (String(scripts[name] ?? "") !== expected) {
      issues.push(
        issue(
          "ADMIN_DEPLOY_PIPELINE",
          `package.json#scripts.${name}`,
          `${name} must exactly match the approved validation-first production pipeline`,
        ),
      );
    }
  }

  issues.push(...validateAdminLoader(adminHtml, origins));

  const requiredHeaders = [
    "X-Robots-Tag: noindex, nofollow",
    "Cache-Control: no-store",
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "X-Frame-Options: DENY",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ];
  if (requiredHeaders.some((header) => !headersSource.includes(header))) {
    issues.push(
      issue(
        "ADMIN_HEADERS",
        "_headers",
        "CMS Admin security headers are incomplete",
      ),
    );
  }

  const auxiliaryFiles = publicFiles.filter(
    (path) => path !== resolve(publicRoot, "index.html"),
  );
  const publicSource = (
    await Promise.all(auxiliaryFiles.map((path) => readFile(path, "utf8")))
  ).join("\n");
  if (
    auxiliaryFiles.some((path) => extname(path).toLowerCase() === ".js") ||
    /<script\b|@import\s+|url\(\s*["']?https?:|\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/i.test(
      publicSource,
    )
  ) {
    issues.push(
      issue(
        "ADMIN_THIRD_PARTY_CODE",
        "public",
        "CMS Admin must not contain advertising or analytics code",
      ),
    );
  }

  return issues;
};

try {
  const input = await readProductionOrigins(configPath);
  const originResult = validateProductionOrigins(input);
  const issues = [...originResult.issues];
  if (
    originResult.origins.CMS_ADMIN_ORIGIN &&
    originResult.origins.CMS_AUTH_ORIGIN
  ) {
    issues.push(...(await validateAdminConfiguration(originResult.origins)));
  }

  if (issues.length > 0) {
    console.error(formatProductionIssues(issues));
    process.exitCode = 1;
  } else {
    console.log("CMS Admin production configuration verified.");
  }
} catch (error) {
  console.error(
    `ADMIN_CONFIG_READ_FAILED ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
