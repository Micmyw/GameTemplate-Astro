import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

type AuthCase = {
  name: string;
  mutation: string;
  expectedCode: string;
};

const packageRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(packageRoot, "../..");
const validatorPath = resolve(
  packageRoot,
  "scripts/verify-production-config.mjs",
);
const casesPath = resolve(import.meta.dirname, "production-config-cases.json");

const origins = {
  PUBLIC_SITE_ORIGIN: "https://arcade.testsite.dev",
  CMS_ADMIN_ORIGIN: "https://cms.testsite.dev",
  CMS_AUTH_ORIGIN: "https://cms-auth.testsite.dev",
  GAME_ORIGIN: "https://play.testsite.dev",
};

const validWrangler = `{
  "name": "game-site-cms-auth",
  "main": "src/index.ts",
  "tsconfig": "./tsconfig.json",
  "vars": {
    "CMS_ADMIN_ORIGIN": "https://cms.example.test",
    "CMS_AUTH_ORIGIN": "https://cms-auth.example.test"
  },
  "observability": {
    "logs": { "invocation_logs": false },
    "traces": { "enabled": false }
  },
  "env": {
    "production": {
      "vars": {
        "CMS_ADMIN_ORIGIN": "https://cms.testsite.dev",
        "CMS_AUTH_ORIGIN": "https://cms-auth.testsite.dev"
      },
      "observability": {
        "logs": { "invocation_logs": false },
        "traces": { "enabled": false }
      }
    }
  }
}
`;

const validHandler = `const callbackUri = (origins) => \`${"${origins.auth}"}/callback\`;
window.opener.postMessage(authorizingMessage, targetOrigin);
window.opener.postMessage(successMessage, targetOrigin);
`;

const validPackage = {
  scripts: {
    "deploy:production:dry":
      "npm run format:check && npm run check && npm run test && npm run cf:typegen && npm run verify:production-config && wrangler deploy --dry-run --env production",
    "deploy:production":
      "npm run format:check && npm run check && npm run test && npm run cf:typegen && npm run verify:production-config && wrangler deploy --env production",
  },
};

const cases = JSON.parse(readFileSync(casesPath, "utf8")) as AuthCase[];
let runtimeRoot: string;

beforeAll(async () => {
  runtimeRoot = await mkdtemp(join(tmpdir(), "cms-auth-production-"));
});

afterAll(async () => {
  await rm(runtimeRoot, { force: true, recursive: true });
});

const mutate = (mutation?: string) => {
  let wrangler = validWrangler;
  let handler = validHandler;
  const packageJson = structuredClone(validPackage);

  if (mutation === "removeProduction") {
    wrangler = wrangler.replace(/,\n  "env": \{[\s\S]*\n  \}\n\}/, "\n}");
  } else if (mutation === "wrongAdminOrigin") {
    wrangler = wrangler.replace(
      '"CMS_ADMIN_ORIGIN": "https://cms.testsite.dev"',
      '"CMS_ADMIN_ORIGIN": "https://other.testsite.dev"',
    );
  } else if (mutation === "productionDefault") {
    wrangler = wrangler.replace(
      '"CMS_ADMIN_ORIGIN": "https://cms.example.test"',
      '"CMS_ADMIN_ORIGIN": "https://cms.testsite.dev"',
    );
  } else if (mutation === "enableInvocationLogs") {
    wrangler = wrangler.replaceAll(
      '"invocation_logs": false',
      '"invocation_logs": true',
    );
  } else if (mutation === "enableTraces") {
    wrangler = wrangler.replaceAll(
      '"traces": { "enabled": false }',
      '"traces": { "enabled": true }',
    );
  } else if (mutation === "secretInVars") {
    wrangler = wrangler.replace(
      '"CMS_AUTH_ORIGIN": "https://cms-auth.testsite.dev"',
      '"CMS_AUTH_ORIGIN": "https://cms-auth.testsite.dev",\n        "GITHUB_OAUTH_SECRET": "forbidden"',
    );
  } else if (mutation === "wildcardPostMessage") {
    handler = handler.replaceAll("targetOrigin", '"*"');
  } else if (mutation === "requestCallback") {
    handler = handler.replace(
      "`${origins.auth}/callback`",
      "`${new URL(request.url).origin}/callback`",
    );
  } else if (mutation === "bypassDeployChecks") {
    packageJson.scripts["deploy:production"] =
      "npm run verify:production-config && wrangler deploy --env production";
  }

  return { handler, packageJson, wrangler };
};

const runFixture = async (
  name: string,
  mutation?: string,
  useDevelopmentPlaceholders = false,
) => {
  const fixtureRoot = join(runtimeRoot, name);
  const authRoot = join(fixtureRoot, "apps/cms-auth");
  const originsPath = join(fixtureRoot, "production-origins.json");
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
    fixture.wrangler = fixture.wrangler
      .replaceAll("cms.testsite.dev", "cms.placeholder.invalid")
      .replaceAll("cms-auth.testsite.dev", "cms-auth.placeholder.invalid");
  }
  await mkdir(join(authRoot, "src"), { recursive: true });
  await Promise.all([
    writeFile(join(authRoot, "wrangler.jsonc"), fixture.wrangler, "utf8"),
    writeFile(join(authRoot, "src/handler.ts"), fixture.handler, "utf8"),
    writeFile(
      join(authRoot, "package.json"),
      `${JSON.stringify(fixture.packageJson, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      originsPath,
      `${JSON.stringify(fixtureOrigins, null, 2)}\n`,
      "utf8",
    ),
  ]);

  return spawnSync(
    process.execPath,
    [validatorPath, "--project-root", fixtureRoot, "--config", originsPath],
    { cwd: projectRoot, encoding: "utf8" },
  );
};

describe("CMS OAuth Worker production configuration CLI", () => {
  it("accepts isolated test and production bindings with private telemetry", async () => {
    const result = await runFixture("valid");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "CMS OAuth production configuration verified",
    );
  });

  it.each(cases.map((invalidCase, index) => [index, invalidCase] as const))(
    "rejects OAuth failure fixture %s with its stable issue code",
    async (index, invalidCase) => {
      const result = await runFixture(`invalid-${index}`, invalidCase.mutation);
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status, invalidCase.name).toBe(1);
      expect(output, invalidCase.name).toContain(invalidCase.expectedCode);
    },
  );

  it("checks the real Worker policy while development placeholders remain blocked", async () => {
    const result = await runFixture(
      "development-placeholder-deep-check",
      "enableInvocationLogs",
      true,
    );
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("PLACEHOLDER_ORIGIN");
    expect(output).toContain("AUTH_INVOCATION_LOGS");
  });
});
