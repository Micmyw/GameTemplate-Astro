import { readFile } from "node:fs/promises";

export const PRODUCTION_ORIGIN_KEYS = [
  "PUBLIC_SITE_ORIGIN",
  "CMS_ADMIN_ORIGIN",
  "CMS_AUTH_ORIGIN",
  "GAME_ORIGIN",
];

const placeholderHostname = (hostname) =>
  hostname === "example.com" ||
  hostname.endsWith(".example.com") ||
  hostname === "example.test" ||
  hostname.endsWith(".example.test") ||
  hostname === "invalid" ||
  hostname.endsWith(".invalid");

const issue = (code, field, message) => ({ code, field, message });

export const validateProductionOrigins = (input) => {
  const issues = [];
  const parsed = new Map();

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
    if (placeholderHostname(url.hostname.toLowerCase())) {
      issues.push(
        issue(
          "PLACEHOLDER_ORIGIN",
          field,
          `${field} must not use a reserved placeholder hostname`,
        ),
      );
      continue;
    }

    parsed.set(field, url.origin);
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
