import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "jsonc-parser";

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
const authRoot = resolve(projectRoot, "apps/cms-auth");

const issue = (code, field, message) => ({ code, field, message });
const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const containsSecretBinding = (value) => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretBinding);
  return Object.entries(value).some(
    ([key, child]) =>
      key === "GITHUB_OAUTH_ID" ||
      key === "GITHUB_OAUTH_SECRET" ||
      containsSecretBinding(child),
  );
};

const privateTelemetryIssues = (config, prefix) => {
  const issues = [];
  const observability = asRecord(config.observability);
  const logs = asRecord(observability.logs);
  const traces = asRecord(observability.traces);
  if (logs.invocation_logs !== false) {
    issues.push(
      issue(
        "AUTH_INVOCATION_LOGS",
        `${prefix}.observability.logs.invocation_logs`,
        "OAuth invocation URL logging must be disabled",
      ),
    );
  }
  if (traces.enabled !== false) {
    issues.push(
      issue(
        "AUTH_TRACES",
        `${prefix}.observability.traces.enabled`,
        "OAuth traces must be disabled",
      ),
    );
  }
  return issues;
};

const validateAuthConfiguration = (
  origins,
  wrangler,
  handlerSource,
  packageJson,
) => {
  const issues = [];
  const defaultVars = asRecord(wrangler.vars);
  const environments = asRecord(wrangler.env);
  const production = asRecord(environments.production);
  const productionVars = asRecord(production.vars);

  if (Object.keys(production).length === 0) {
    issues.push(
      issue(
        "AUTH_PRODUCTION_ENV",
        "wrangler.env.production",
        "OAuth Worker must define an isolated production environment",
      ),
    );
  }
  if (
    defaultVars.CMS_ADMIN_ORIGIN !== "https://cms.example.test" ||
    defaultVars.CMS_AUTH_ORIGIN !== "https://cms-auth.example.test"
  ) {
    issues.push(
      issue(
        "AUTH_TEST_DEFAULTS",
        "wrangler.vars",
        "Default OAuth bindings must remain test-only .example.test values",
      ),
    );
  }
  if (
    productionVars.CMS_ADMIN_ORIGIN !== origins.CMS_ADMIN_ORIGIN ||
    productionVars.CMS_AUTH_ORIGIN !== origins.CMS_AUTH_ORIGIN
  ) {
    issues.push(
      issue(
        "AUTH_PRODUCTION_VARS",
        "wrangler.env.production.vars",
        "Production OAuth bindings must match the approved Origins",
      ),
    );
  }

  issues.push(...privateTelemetryIssues(wrangler, "wrangler"));
  issues.push(...privateTelemetryIssues(production, "wrangler.env.production"));

  if (containsSecretBinding(wrangler)) {
    issues.push(
      issue(
        "AUTH_SECRET_CONFIG",
        "wrangler",
        "OAuth Client ID and Secret must use Cloudflare Secrets",
      ),
    );
  }
  if (/postMessage\s*\([^)]*,\s*["']\*["']/s.test(handlerSource)) {
    issues.push(
      issue(
        "AUTH_POSTMESSAGE",
        "handler.ts",
        "OAuth popup messages must target the exact Admin Origin",
      ),
    );
  }
  if (!handlerSource.includes("`${origins.auth}/callback`")) {
    issues.push(
      issue(
        "AUTH_CALLBACK_ORIGIN",
        "handler.ts",
        "OAuth callback must be derived only from CMS_AUTH_ORIGIN",
      ),
    );
  }

  const scripts = asRecord(packageJson.scripts);
  const expectedDry =
    "npm run format:check && npm run check && npm run test && npm run cf:typegen && npm run verify:production-config && wrangler deploy --dry-run --env production";
  const expectedDeploy =
    "npm run format:check && npm run check && npm run test && npm run cf:typegen && npm run verify:production-config && wrangler deploy --env production";
  const productionDry = String(scripts["deploy:production:dry"] ?? "");
  const productionScript = String(scripts["deploy:production"] ?? "");
  if (productionDry !== expectedDry || productionScript !== expectedDeploy) {
    issues.push(
      issue(
        "AUTH_DEPLOY_PIPELINE",
        "package.json",
        "OAuth production deploy scripts must exactly match the approved validation-first pipelines",
      ),
    );
  }

  return issues;
};

try {
  const [input, wranglerSource, handlerSource, packageSource] =
    await Promise.all([
      readProductionOrigins(configPath),
      readFile(resolve(authRoot, "wrangler.jsonc"), "utf8"),
      readFile(resolve(authRoot, "src/handler.ts"), "utf8"),
      readFile(resolve(authRoot, "package.json"), "utf8"),
    ]);
  const originResult = validateProductionOrigins(input);
  const issues = [...originResult.issues];
  if (
    originResult.origins.CMS_ADMIN_ORIGIN &&
    originResult.origins.CMS_AUTH_ORIGIN
  ) {
    const parseErrors = [];
    const wrangler = parse(wranglerSource, parseErrors, {
      allowTrailingComma: true,
    });
    if (parseErrors.length > 0) {
      issues.push(
        issue(
          "AUTH_WRANGLER_PARSE",
          "wrangler.jsonc",
          "OAuth Wrangler configuration is invalid JSONC",
        ),
      );
    } else {
      issues.push(
        ...validateAuthConfiguration(
          originResult.origins,
          asRecord(wrangler),
          handlerSource,
          asRecord(JSON.parse(packageSource)),
        ),
      );
    }
  }

  if (issues.length > 0) {
    console.error(formatProductionIssues(issues));
    process.exitCode = 1;
  } else {
    console.log("CMS OAuth production configuration verified.");
  }
} catch (error) {
  console.error(
    `AUTH_CONFIG_READ_FAILED ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
