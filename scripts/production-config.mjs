import { readFile } from "node:fs/promises";
import { isIP } from "node:net";

export const PRODUCTION_ORIGIN_KEYS = [
  "PUBLIC_SITE_ORIGIN",
  "CMS_ADMIN_ORIGIN",
  "CMS_AUTH_ORIGIN",
  "GAME_ORIGIN",
];
const productionOriginKeySet = new Set(PRODUCTION_ORIGIN_KEYS);
const placeholderSiteNames = new Set([
  "gamesite",
  "placeholder",
  "site name",
  "your site",
]);

/**
 * @typedef {object} ProductionEnvironment
 * @property {string | undefined} [PUBLIC_SITE_NAME]
 * @property {string | undefined} [PUBLIC_SITE_URL]
 * @property {string | undefined} [PUBLIC_GAME_ORIGINS]
 * @property {string | undefined} [PUBLIC_ADS_MODE]
 */

const placeholderHostname = (hostname) =>
  hostname === "example.com" ||
  hostname.endsWith(".example.com") ||
  hostname === "example" ||
  hostname.endsWith(".example") ||
  hostname === "test" ||
  hostname.endsWith(".test") ||
  hostname === "example.test" ||
  hostname.endsWith(".example.test") ||
  hostname === "invalid" ||
  hostname.endsWith(".invalid");

const isPublicHostname = (hostname) => {
  if (
    hostname.endsWith(".") ||
    hostname.includes("*") ||
    hostname.includes("_")
  ) {
    return false;
  }

  const unwrappedHostname = hostname.replace(/^\[|\]$/g, "");
  if (isIP(unwrappedHostname) !== 0) return false;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".home.arpa")
  ) {
    return false;
  }

  const labels = hostname.split(".");
  return (
    labels.length >= 2 &&
    hostname.length <= 253 &&
    labels.every(
      (label) =>
        label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
    )
  );
};

const issue = (code, field, message) => ({ code, field, message });

const validateOriginValue = (field, value, missingCode = "MISSING_ORIGIN") => {
  const issues = [];
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(issue(missingCode, field, `${field} is required`));
    return { issues, origin: undefined };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    issues.push(
      issue("INVALID_ORIGIN", field, `${field} must be an absolute URL`),
    );
    return { issues, origin: undefined };
  }

  if (url.username !== "" || url.password !== "") {
    issues.push(
      issue(
        "ORIGIN_CREDENTIALS",
        field,
        `${field} must not contain credentials`,
      ),
    );
    return { issues, origin: undefined };
  }
  if (url.protocol !== "https:") {
    issues.push(issue("HTTPS_REQUIRED", field, `${field} must use HTTPS`));
    return { issues, origin: undefined };
  }
  if (
    value !== url.origin ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    issues.push(
      issue(
        "ORIGIN_ONLY",
        field,
        `${field} must contain only scheme and authority`,
      ),
    );
    return { issues, origin: undefined };
  }

  const hostname = url.hostname.toLowerCase();
  const normalizedHostname = hostname.replace(/\.$/, "");
  if (placeholderHostname(normalizedHostname)) {
    issues.push(
      issue(
        "PLACEHOLDER_ORIGIN",
        field,
        `${field} must not use a reserved placeholder hostname`,
      ),
    );
  }
  if (!isPublicHostname(hostname)) {
    issues.push(
      issue(
        "PUBLIC_HOST_REQUIRED",
        field,
        `${field} must use a canonical public DNS hostname`,
      ),
    );
  }

  return { issues, origin: url.origin };
};

export const validateProductionOrigins = (input) => {
  const issues = [];
  const parsed = new Map();

  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const field of Object.keys(input)) {
      if (!productionOriginKeySet.has(field)) {
        issues.push(
          issue(
            "UNKNOWN_ORIGIN_KEY",
            field,
            `${field} is not an approved production Origin property`,
          ),
        );
      }
    }
  }

  for (const field of PRODUCTION_ORIGIN_KEYS) {
    const result = validateOriginValue(field, input?.[field]);
    issues.push(...result.issues);
    if (result.origin) parsed.set(field, result.origin);
  }

  const owners = new Map();
  for (const [field, origin] of parsed) {
    const previous = owners.get(origin);
    if (previous) {
      issues.push(
        issue(
          "DUPLICATE_ORIGIN",
          field,
          `${field} must differ from ${previous}`,
        ),
      );
    } else {
      owners.set(origin, field);
    }
  }

  return { issues, origins: Object.fromEntries(parsed) };
};

/**
 * @param {ProductionEnvironment | undefined} environment
 * @param {Record<string, string>} manifest
 */
export const validateProductionRuntime = (environment, manifest) => {
  const issues = [];
  const rawSiteName = environment?.PUBLIC_SITE_NAME;
  let siteName;
  if (typeof rawSiteName !== "string" || rawSiteName.trim() === "") {
    issues.push(
      issue(
        "MISSING_PUBLIC_SITE_NAME",
        "PUBLIC_SITE_NAME",
        "PUBLIC_SITE_NAME is required",
      ),
    );
  } else {
    const normalizedSiteName = rawSiteName.trim();
    if (normalizedSiteName.length < 2 || normalizedSiteName.length > 60) {
      issues.push(
        issue(
          "INVALID_PUBLIC_SITE_NAME",
          "PUBLIC_SITE_NAME",
          "PUBLIC_SITE_NAME must contain between 2 and 60 characters",
        ),
      );
    } else if (
      placeholderSiteNames.has(
        normalizedSiteName.toLocaleLowerCase("en-US").replace(/\s+/g, " "),
      )
    ) {
      issues.push(
        issue(
          "PLACEHOLDER_SITE_NAME",
          "PUBLIC_SITE_NAME",
          "PUBLIC_SITE_NAME must be a real production brand",
        ),
      );
    } else {
      siteName = normalizedSiteName;
    }
  }

  const adsMode = environment?.PUBLIC_ADS_MODE?.trim();
  if (adsMode && adsMode !== "disabled") {
    issues.push(
      issue(
        "PRODUCTION_ADS_MODE",
        "PUBLIC_ADS_MODE",
        "PUBLIC_ADS_MODE must be disabled in production",
      ),
    );
  }
  const siteResult = validateOriginValue(
    "PUBLIC_SITE_URL",
    environment?.PUBLIC_SITE_URL,
    "MISSING_PUBLIC_SITE_URL",
  );
  issues.push(...siteResult.issues);
  if (
    siteResult.issues.length === 0 &&
    siteResult.origin !== manifest.PUBLIC_SITE_ORIGIN
  ) {
    issues.push(
      issue(
        "PUBLIC_SITE_URL_MISMATCH",
        "PUBLIC_SITE_URL",
        "PUBLIC_SITE_URL must equal PUBLIC_SITE_ORIGIN",
      ),
    );
  }

  const rawGameOrigins = environment?.PUBLIC_GAME_ORIGINS;
  const gameOrigins = [];
  if (typeof rawGameOrigins !== "string" || rawGameOrigins.trim() === "") {
    issues.push(
      issue(
        "MISSING_PUBLIC_GAME_ORIGINS",
        "PUBLIC_GAME_ORIGINS",
        "PUBLIC_GAME_ORIGINS is required",
      ),
    );
  } else {
    const values = rawGameOrigins.split(",").map((value) => value.trim());
    if (values.some((value) => value === "")) {
      issues.push(
        issue(
          "INVALID_GAME_ORIGIN_LIST",
          "PUBLIC_GAME_ORIGINS",
          "PUBLIC_GAME_ORIGINS must be a comma-separated list of Origins",
        ),
      );
    }

    for (const [index, value] of values.entries()) {
      if (!value) continue;
      const result = validateOriginValue(
        `PUBLIC_GAME_ORIGINS[${index}]`,
        value,
      );
      issues.push(...result.issues);
      if (result.origin) gameOrigins.push(result.origin);
    }
  }

  const uniqueGameOrigins = new Set(gameOrigins);
  if (uniqueGameOrigins.size !== gameOrigins.length) {
    issues.push(
      issue(
        "DUPLICATE_GAME_ORIGIN",
        "PUBLIC_GAME_ORIGINS",
        "PUBLIC_GAME_ORIGINS must not contain duplicates",
      ),
    );
  }

  const nonGameRoles = [
    manifest.PUBLIC_SITE_ORIGIN,
    manifest.CMS_ADMIN_ORIGIN,
    manifest.CMS_AUTH_ORIGIN,
  ];
  if (gameOrigins.some((origin) => nonGameRoles.includes(origin))) {
    issues.push(
      issue(
        "GAME_ORIGIN_ROLE_COLLISION",
        "PUBLIC_GAME_ORIGINS",
        "game Origins must differ from public, CMS Admin, and CMS Auth Origins",
      ),
    );
  }
  if (manifest.GAME_ORIGIN && !uniqueGameOrigins.has(manifest.GAME_ORIGIN)) {
    issues.push(
      issue(
        "GAME_ORIGIN_NOT_ALLOWED",
        "PUBLIC_GAME_ORIGINS",
        "PUBLIC_GAME_ORIGINS must include the configured GAME_ORIGIN",
      ),
    );
  }

  return {
    issues,
    siteName,
    siteOrigin: siteResult.origin,
    gameOrigins: [...uniqueGameOrigins],
  };
};

export const readProductionOrigins = async (path) => {
  const source = await readFile(path, "utf8");
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Production Origin configuration must be a JSON object");
  }
  return value;
};

export const formatProductionIssues = (issues) =>
  issues
    .map(({ code, field, message }) => `${code} ${field}: ${message}`)
    .join("\n");
