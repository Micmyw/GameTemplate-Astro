import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

type RootCase = {
  name: string;
  mutation: string;
  expectedCode: string;
};

const projectRoot = resolve(import.meta.dirname, "../..");
const validatorPath = resolve(
  projectRoot,
  "scripts/verify-production-config.mjs",
);
const casesPath = resolve(
  projectRoot,
  "tests/fixtures/production-config/root-cases.json",
);
const origins = {
  PUBLIC_SITE_ORIGIN: "https://arcade.testsite.dev",
  CMS_ADMIN_ORIGIN: "https://cms.testsite.dev",
  CMS_AUTH_ORIGIN: "https://cms-auth.testsite.dev",
  GAME_ORIGIN: "https://play.testsite.dev",
};

const cases = JSON.parse(readFileSync(casesPath, "utf8")) as RootCase[];
let runtimeRoot: string;

beforeAll(async () => {
  runtimeRoot = await mkdtemp(join(tmpdir(), "root-production-config-"));
});

afterAll(async () => {
  await rm(runtimeRoot, { force: true, recursive: true });
});

const runGit = (root: string, args: string[]) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr}`);
  }
};

const runFixture = async (name: string, mutation?: string) => {
  const fixtureRoot = join(runtimeRoot, name);
  const originsPath = join(fixtureRoot, "config/production-origins.json");
  const files = new Map<string, string>([
    [originsPath, `${JSON.stringify(origins, null, 2)}\n`],
    [
      join(fixtureRoot, "public/index.html"),
      "<!doctype html><h1>Arcade</h1>\n",
    ],
    [join(fixtureRoot, "src/pages/index.astro"), "<h1>Arcade</h1>\n"],
    [join(fixtureRoot, "wrangler.jsonc"), '{ "name": "game-site" }\n'],
    [
      join(fixtureRoot, "package.json"),
      `${JSON.stringify(
        {
          scripts: {
            deploy:
              "npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && npm run verify:production-config && wrangler deploy",
            "deploy:production:dry":
              "npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && npm run verify:production-config && wrangler deploy --dry-run",
            "deploy:production":
              "npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && npm run verify:production-config && wrangler deploy",
          },
        },
        null,
        2,
      )}\n`,
    ],
  ]);

  if (mutation === "publicAdmin") {
    files.set(join(fixtureRoot, "public/admin/index.html"), "legacy Admin\n");
  } else if (mutation === "publicDecap") {
    files.set(
      join(fixtureRoot, "public/index.html"),
      '<script src="https://unpkg.com/decap-cms@3.15.1/dist/decap-cms.js"></script>\n',
    );
  } else if (mutation === "trackedDevVars") {
    files.set(join(fixtureRoot, ".dev.vars.production"), "TOKEN=forbidden\n");
  } else if (mutation === "secretConfig") {
    files.set(
      join(fixtureRoot, "wrangler.jsonc"),
      '{ "vars": { "GITHUB_OAUTH_SECRET": "forbidden" } }\n',
    );
  } else if (mutation === "clientIdConfig") {
    files.set(
      join(fixtureRoot, ".env.production"),
      "GITHUB_OAUTH_ID=forbidden\n",
    );
  } else if (mutation === "astroAdminPage") {
    files.set(join(fixtureRoot, "src/pages/admin.astro"), "<h1>Admin</h1>\n");
  } else if (mutation === "secretJsonConfig") {
    files.set(
      originsPath,
      `${JSON.stringify(
        { ...origins, GITHUB_OAUTH_SECRET: "forbidden" },
        null,
        2,
      )}\n`,
    );
  } else if (mutation === "bypassRootDeploy") {
    files.set(
      join(fixtureRoot, "package.json"),
      `${JSON.stringify(
        {
          scripts: {
            deploy: "wrangler deploy",
            "deploy:production:dry": "wrangler deploy --dry-run",
            "deploy:production": "wrangler deploy",
          },
        },
        null,
        2,
      )}\n`,
    );
  }

  await Promise.all(
    [...files].map(async ([path, contents]) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, "utf8");
    }),
  );
  runGit(fixtureRoot, ["init", "--quiet"]);
  runGit(fixtureRoot, ["add", "--force", "."]);
  if (mutation === "untrackedPublicAdmin") {
    const path = join(fixtureRoot, "public/admin/index.html");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "untracked legacy Admin\n", "utf8");
  } else if (mutation === "untrackedPublicDecap") {
    await writeFile(
      join(fixtureRoot, "public/untracked-cms.js"),
      "import 'decap-cms';\n",
      "utf8",
    );
  }

  return spawnSync(
    process.execPath,
    [
      validatorPath,
      "--scope",
      "all",
      "--project-root",
      fixtureRoot,
      "--config",
      originsPath,
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );
};

describe("repository production configuration gate", () => {
  it("accepts a tracked public site without Admin, Decap, or Secrets", async () => {
    const result = await runFixture("valid");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Repository production configuration verified",
    );
  });

  it.each(cases.map((invalidCase, index) => [index, invalidCase] as const))(
    "rejects repository failure fixture %s with its stable issue code",
    async (index, invalidCase) => {
      const result = await runFixture(`invalid-${index}`, invalidCase.mutation);
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status, invalidCase.name).toBe(1);
      expect(output, invalidCase.name).toContain(invalidCase.expectedCode);
    },
  );
});
