import { readFile } from "node:fs/promises";
import { isIP } from "node:net";

export const PRODUCTION_ORIGIN_KEYS = [
  "PUBLIC_SITE_ORIGIN",
  "CMS_ADMIN_ORIGIN",
  "CMS_AUTH_ORIGIN",
  "GAME_ORIGIN",
];
const productionOriginKeySet = new Set(PRODUCTION_ORIGIN_KEYS);

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
    const value = input?.[field];
    if (typeof value !== "string" || value.trim() === "") {
      issues.push(issue("MISSING_ORIGIN", field, `${field} is required`));
      continue;
    }

    let url;
    try {
      url = new URL(value);
    } catch {
      issues.push(
        issue("INVALID_ORIGIN", field, `${field} must be an absolute URL`),
      );
      continue;
    }

    if (url.username !== "" || url.password !== "") {
      issues.push(
        issue(
          "ORIGIN_CREDENTIALS",
          field,
          `${field} must not contain credentials`,
        ),
      );
      continue;
    }
    if (url.protocol !== "https:") {
      issues.push(issue("HTTPS_REQUIRED", field, `${field} must use HTTPS`));
      continue;
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
      continue;
    }
    parsed.set(field, url.origin);

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
