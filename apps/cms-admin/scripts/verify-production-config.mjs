import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

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

const validateAdminConfiguration = async (origins) => {
  const issues = [];
  const [configSource, adminHtml, headersSource, publicFiles] =
    await Promise.all([
      readFile(resolve(publicRoot, "config.yml"), "utf8"),
      readFile(resolve(publicRoot, "index.html"), "utf8"),
      readFile(resolve(publicRoot, "_headers"), "utf8"),
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

  const hostnameMatch = adminHtml.match(
    /data-cms-production-hostname\s*=\s*(["'])([^"']+)\1/i,
  );
  const expectedHostname = origins.CMS_ADMIN_ORIGIN
    ? new URL(origins.CMS_ADMIN_ORIGIN).hostname
    : undefined;
  if (!expectedHostname || hostnameMatch?.[2] !== expectedHostname) {
    issues.push(
      issue(
        "ADMIN_HOSTNAME",
        "index.html",
        "Admin production hostname must exactly match CMS_ADMIN_ORIGIN",
      ),
    );
  }
  if (
    adminHtml.includes(".endsWith(") ||
    adminHtml.includes("document.referrer") ||
    adminHtml.includes("document.referer")
  ) {
    issues.push(
      issue(
        "ADMIN_HOST_MATCHING",
        "index.html",
        "Admin hostname approval must not use suffix or referrer matching",
      ),
    );
  }
  if (
    !adminHtml.includes("decap-cms@3.15.1/") ||
    adminHtml.includes("decap-cms@latest") ||
    !/data-cms-integrity\s*=\s*["']sha384-[^"']+["']/i.test(adminHtml) ||
    !adminHtml.includes('crossOrigin = "anonymous"')
  ) {
    issues.push(
      issue(
        "ADMIN_DECAP_CLIENT",
        "index.html",
        "Decap must remain pinned with SRI and anonymous CORS",
      ),
    );
  }

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

  const publicSource = (
    await Promise.all(publicFiles.map((path) => readFile(path, "utf8")))
  )
    .join("\n")
    .toLowerCase();
  if (
    /googlesyndication|doubleclick|googletagmanager|google-analytics|plausible\.io|analytics\.js/.test(
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
  if (originResult.issues.length === 0) {
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
