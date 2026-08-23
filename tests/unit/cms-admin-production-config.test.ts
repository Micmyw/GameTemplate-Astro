import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

type AdminCase = {
  name: string;
  mutation: string;
  expectedCode: string;
};

const projectRoot = resolve(import.meta.dirname, "../..");
const validatorPath = resolve(
  projectRoot,
  "apps/cms-admin/scripts/verify-production-config.mjs",
);
const casesPath = resolve(
  projectRoot,
  "tests/fixtures/production-config/admin-cases.json",
);
const adminPublicRoot = resolve(projectRoot, "apps/cms-admin/public");

const origins = {
  PUBLIC_SITE_ORIGIN: "https://arcade.testsite.dev",
  CMS_ADMIN_ORIGIN: "https://cms.testsite.dev",
  CMS_AUTH_ORIGIN: "https://cms-auth.testsite.dev",
  GAME_ORIGIN: "https://play.testsite.dev",
};

const validConfig = readFileSync(
  resolve(adminPublicRoot, "config.yml"),
  "utf8",
).replaceAll("cms-auth.placeholder.invalid", "cms-auth.testsite.dev");
const validHtml = readFileSync(
  resolve(adminPublicRoot, "index.html"),
  "utf8",
).replaceAll("cms.placeholder.invalid", "cms.testsite.dev");
const validHeaders = readFileSync(resolve(adminPublicRoot, "_headers"), "utf8");
const validPackage = JSON.parse(
  readFileSync(resolve(projectRoot, "apps/cms-admin/package.json"), "utf8"),
);

const cases = JSON.parse(readFileSync(casesPath, "utf8")) as AdminCase[];
let runtimeRoot: string;

beforeAll(async () => {
  runtimeRoot = await mkdtemp(join(tmpdir(), "cms-admin-production-"));
});

afterAll(async () => {
  await rm(runtimeRoot, { force: true, recursive: true });
});

const mutate = (
  mutation: string | undefined,
): {
  config: string;
  headers: string;
  html: string;
  packageJson: typeof validPackage;
} => {
  let config = validConfig;
  let html = validHtml;
  let headers = validHeaders;
  const packageJson = structuredClone(validPackage);

  if (mutation === "removeBaseUrl") {
    config = config.replace("  base_url: https://cms-auth.testsite.dev\n", "");
  } else if (mutation === "wrongAuthEndpoint") {
    config = config.replace(
      "  auth_endpoint: /auth",
      "  auth_endpoint: /oauth",
    );
  } else if (mutation === "removeLocalBackend") {
    config = config.replace(
      "local_backend:\n  url: http://127.0.0.1:8081/api/v1\n",
      "",
    );
  } else if (mutation === "mismatchHostname") {
    html = html.replace("cms.testsite.dev", "other.testsite.dev");
  } else if (mutation === "wildcardHostname") {
    html = html.replace("cms.testsite.dev", "*.testsite.dev");
  } else if (mutation === "suffixGuard") {
    html = html.replace(
      "approvedHostnames.has(hostname)",
      'hostname.endsWith("testsite.dev")',
    );
  } else if (mutation === "refererGuard") {
    html = html.replace(
      "approvedHostnames.has(hostname)",
      'new URL(document.referrer).hostname === "cms.testsite.dev"',
    );
  } else if (mutation === "removeNoStore") {
    headers = headers.replace("  Cache-Control: no-store\n", "");
  } else if (mutation === "analyticsScript") {
    html = html.replace(
      "</body>",
      '<script src="https://www.googletagmanager.com/gtag/js"></script></body>',
    );
  } else if (mutation === "advertisingScript") {
    html = html.replace(
      "</body>",
      '<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script></body>',
    );
  } else if (mutation === "disabledGuard") {
    html = html.replace("if (!approvedHostnames.has(hostname))", "if (true)");
  } else if (mutation === "allowAnyHostname") {
    html = html.replace("if (!approvedHostnames.has(hostname))", "if (false)");
  } else if (mutation === "commentedHostname") {
    html = html
      .replace('    data-cms-production-hostname="cms.testsite.dev"\n', "")
      .replace(
        "  <body\n",
        '  <!-- data-cms-production-hostname="cms.testsite.dev" -->\n  <body\n',
      );
  } else if (mutation === "attackerDecapUrl") {
    html = html.replace(
      "https://unpkg.com/decap-cms@3.15.1/dist/decap-cms.js",
      "https://attacker.test/decap-cms@3.15.1/dist/decap-cms.js",
    );
  } else if (mutation === "wrongIntegrity") {
    html = html.replace(
      "sha384-in6eHztHveqQ7uMZ1fDaKlDmacQLFuLH2wWrFTiymyuS8zQ5bixwL8U3AeRi8h/L",
      "sha384-fixture",
    );
  } else if (mutation === "externalScript") {
    html = html.replace(
      "</body>",
      '<script src="https://attacker.test/client.js"></script></body>',
    );
  } else if (mutation === "posthogScript") {
    html = html.replace(
      "</body>",
      '<script src="https://cdn.posthog.com/posthog.js"></script></body>',
    );
  } else if (mutation === "matomoScript") {
    html = html.replace(
      "</body>",
      '<script src="https://analytics.test/matomo.js"></script></body>',
    );
  } else if (mutation === "maskDeployFailure") {
    packageJson.scripts["deploy:production"] =
      "npm run format:check && npm run test:headers && npm run verify:production-config || true && wrangler deploy --env production";
  } else if (mutation === "deployBeforeValidation") {
    packageJson.scripts["deploy:production:dry"] =
      "wrangler deploy --env production && npm run format:check && npm run test:headers && npm run verify:production-config && wrangler deploy --dry-run --env production";
  }

  return { config, headers, html, packageJson };
};

const runFixture = async (
  name: string,
  mutation?: string,
  useDevelopmentPlaceholders = false,
) => {
  const fixtureRoot = join(runtimeRoot, name);
  const publicRoot = join(fixtureRoot, "apps/cms-admin/public");
  const originsPath = join(fixtureRoot, "production-origins.json");
  await mkdir(publicRoot, { recursive: true });
  const fixture = mutate(mutation);
  const fixtureOrigins = useDevelopmentPlaceholders
    ? {
        PUBLIC_SITE_ORIGIN: "https://www.placeholder.invalid",
        CMS_ADMIN_ORIGIN: "https://cms.placeholder.invalid",
        CMS_AUTH_ORIGIN: "https://cms-auth.placeholder.invalid",
        GAME_ORIGIN: "https://play.placeholder.invalid",
      }
    : origins;
  if (useDevelopmentPlaceholders) {
    fixture.config = fixture.config.replaceAll(
      "cms-auth.testsite.dev",
      "cms-auth.placeholder.invalid",
    );
    fixture.html = fixture.html.replaceAll(
      "cms.testsite.dev",
      "cms.placeholder.invalid",
    );
  }
  const files = new Map([
    [join(publicRoot, "config.yml"), fixture.config],
    [join(publicRoot, "index.html"), fixture.html],
    [join(publicRoot, "_headers"), fixture.headers],
    [
      join(fixtureRoot, "apps/cms-admin/package.json"),
      `${JSON.stringify(fixture.packageJson, null, 2)}\n`,
    ],
    [originsPath, `${JSON.stringify(fixtureOrigins, null, 2)}\n`],
  ]);
  await Promise.all(
    [...files].map(async ([path, contents]) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, "utf8");
    }),
  );

  return spawnSync(
    process.execPath,
    [validatorPath, "--project-root", fixtureRoot, "--config", originsPath],
    { cwd: projectRoot, encoding: "utf8" },
  );
};

describe("CMS Admin production configuration CLI", () => {
  it("accepts an exact production hostname, backend, and security boundary", async () => {
    const result = await runFixture("valid");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "CMS Admin production configuration verified",
    );
  });

  it.each(cases.map((invalidCase, index) => [index, invalidCase] as const))(
    "rejects Admin failure fixture %s with its stable issue code",
    async (index, invalidCase) => {
      const result = await runFixture(`invalid-${index}`, invalidCase.mutation);
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status, invalidCase.name).toBe(1);
      expect(output, invalidCase.name).toContain(invalidCase.expectedCode);
    },
  );

  it("checks the real Admin policy while development placeholders remain blocked", async () => {
    const result = await runFixture(
      "development-placeholder-deep-check",
      "posthogScript",
      true,
    );
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("PLACEHOLDER_ORIGIN");
    expect(output).toContain("ADMIN_THIRD_PARTY_CODE");
  });
});
