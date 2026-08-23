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

const origins = {
  PUBLIC_SITE_ORIGIN: "https://arcade.testsite.dev",
  CMS_ADMIN_ORIGIN: "https://cms.testsite.dev",
  CMS_AUTH_ORIGIN: "https://cms-auth.testsite.dev",
  GAME_ORIGIN: "https://play.testsite.dev",
};

const validConfig = `backend:
  name: github
  repo: Micmyw/GameTemplate-Astro
  branch: main
  auth_scope: public_repo
  base_url: https://cms-auth.testsite.dev
  auth_endpoint: /auth
local_backend:
  url: http://127.0.0.1:8081/api/v1
`;

const validHtml = `<!doctype html>
<body
  data-cms-src="https://unpkg.com/decap-cms@3.15.1/dist/decap-cms.js"
  data-cms-integrity="sha384-fixture"
  data-cms-production-hostname="cms.testsite.dev"
>
  <script>
    const approvedHostnames = new Set(["localhost", "127.0.0.1", "::1", document.body.dataset.cmsProductionHostname]);
    approvedHostnames.has(window.location.hostname);
    const client = {};
    client.crossOrigin = "anonymous";
  </script>
</body>
`;

const validHeaders = `/*
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; object-src 'none'
`;

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
): { config: string; html: string; headers: string } => {
  let config = validConfig;
  let html = validHtml;
  let headers = validHeaders;

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
      "approvedHostnames.has(window.location.hostname);",
      "window.location.hostname.endsWith('testsite.dev');",
    );
  } else if (mutation === "refererGuard") {
    html = html.replace(
      "approvedHostnames.has(window.location.hostname);",
      "new URL(document.referrer).hostname === 'cms.testsite.dev';",
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
  }

  return { config, html, headers };
};

const runFixture = async (name: string, mutation?: string) => {
  const fixtureRoot = join(runtimeRoot, name);
  const publicRoot = join(fixtureRoot, "apps/cms-admin/public");
  const originsPath = join(fixtureRoot, "production-origins.json");
  await mkdir(publicRoot, { recursive: true });
  const fixture = mutate(mutation);
  const files = new Map([
    [join(publicRoot, "config.yml"), fixture.config],
    [join(publicRoot, "index.html"), fixture.html],
    [join(publicRoot, "_headers"), fixture.headers],
    [originsPath, `${JSON.stringify(origins, null, 2)}\n`],
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
});
