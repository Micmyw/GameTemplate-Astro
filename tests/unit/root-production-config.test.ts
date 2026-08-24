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
const defaultSiteName = "Arcade Atlas";
const validEnvironment = {
  PUBLIC_SITE_NAME: defaultSiteName,
  PUBLIC_SITE_URL: origins.PUBLIC_SITE_ORIGIN,
  PUBLIC_GAME_ORIGINS: origins.GAME_ORIGIN,
};

type PageOptions = {
  duplicateSiteNameMeta?: boolean;
  includeSiteNameMeta?: boolean;
  ogSiteName?: string;
  siteName?: string;
  titleSiteName?: string;
  websiteSchemaName?: string;
  wordmarkName?: string;
};

const canonicalPage = (path: string, options: PageOptions = {}) => {
  const siteName = options.siteName ?? defaultSiteName;
  const ogSiteName = options.ogSiteName ?? siteName;
  const titleSiteName = options.titleSiteName ?? siteName;
  const wordmarkName = options.wordmarkName ?? siteName;
  const siteNameMeta =
    options.includeSiteNameMeta === false
      ? ""
      : `<meta property="og:site_name" content="${ogSiteName}">`;
  const duplicateSiteNameMeta = options.duplicateSiteNameMeta
    ? `<meta property="og:site_name" content="${ogSiteName}">`
    : "";
  const websiteSchema =
    path === "/"
      ? `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: options.websiteSchemaName ?? siteName,
          url: origins.PUBLIC_SITE_ORIGIN,
        })}</script>`
      : "";

  return `<!doctype html><html><head><title>Fixture | ${titleSiteName}</title><meta name="robots" content="index, follow"><link rel="canonical" href="${origins.PUBLIC_SITE_ORIGIN}${path}">${siteNameMeta}${duplicateSiteNameMeta}${websiteSchema}</head><body><header><a class="wordmark" href="/"><span>AA</span>${wordmarkName}</a></header><h1>Arcade</h1></body></html>\n`;
};

const sitemap = (paths: string[]) =>
  `<?xml version="1.0"?><urlset>${paths
    .map((path) => `<url><loc>${origins.PUBLIC_SITE_ORIGIN}${path}</loc></url>`)
    .join("")}</urlset>\n`;

const productionPreflight =
  "npm run format:check && npm run check && npm run test && npm run build:production && npm run verify:dist && npm run test:e2e && npm run verify:production-config";
const productionDeployScripts = {
  "format:check": "prettier --check .",
  check: "astro check",
  test: "vitest run --no-file-parallelism --exclude=tests/e2e/**",
  "build:production": "astro build --mode production",
  "verify:dist": "node scripts/verify-dist.mjs",
  "test:e2e": "playwright test",
  "verify:production-config": "node scripts/verify-production-config.mjs",
  "deploy:dry": "npm run deploy:production:dry",
  deploy: "npm run deploy:production",
  "deploy:production:dry": `${productionPreflight} && npx wrangler deploy --dry-run`,
  "deploy:production": `${productionPreflight} && npx wrangler deploy --dry-run && npx wrangler deploy`,
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
  const fixtureSiteName = ["validSiteName", "trimmedSiteName"].includes(
    mutation ?? "",
  )
    ? "Real Arcade"
    : defaultSiteName;
  const files = new Map<string, string>([
    [originsPath, `${JSON.stringify(origins, null, 2)}\n`],
    [
      join(fixtureRoot, "public/index.html"),
      "<!doctype html><h1>Arcade</h1>\n",
    ],
    [
      join(fixtureRoot, "public/_headers"),
      "/*\n  X-Content-Type-Options: nosniff\n\nhttps://:version.:subdomain.workers.dev/*\n  X-Robots-Tag: noindex, nofollow\n",
    ],
    [join(fixtureRoot, "src/pages/index.astro"), "<h1>Arcade</h1>\n"],
    [
      join(fixtureRoot, "src/config/ads.ts"),
      `export const AD_SLOT_IDS = ["home-after-featured"] as const;\nexport const createAdsConfig = () => ({ mode: "disabled", slots: { "home-after-featured": false } });\n`,
    ],
    [
      join(fixtureRoot, "src/content/games/draft-game.md"),
      "---\nstatus: draft\n---\nDraft fixture\n",
    ],
    [
      join(fixtureRoot, "dist/index.html"),
      canonicalPage("/", { siteName: fixtureSiteName }),
    ],
    [
      join(fixtureRoot, "dist/games/demo/index.html"),
      canonicalPage("/games/demo/", { siteName: fixtureSiteName }),
    ],
    [
      join(fixtureRoot, "dist/404.html"),
      canonicalPage("/404.html", { siteName: fixtureSiteName }),
    ],
    [
      join(fixtureRoot, "dist/robots.txt"),
      `User-agent: *\nAllow: /\nSitemap: ${origins.PUBLIC_SITE_ORIGIN}/sitemap-index.xml\n`,
    ],
    [
      join(fixtureRoot, "dist/sitemap-index.xml"),
      `<?xml version="1.0"?><sitemapindex><sitemap><loc>${origins.PUBLIC_SITE_ORIGIN}/sitemap-0.xml</loc></sitemap></sitemapindex>\n`,
    ],
    [join(fixtureRoot, "dist/sitemap-0.xml"), sitemap(["/", "/games/demo/"])],
    [join(fixtureRoot, "wrangler.jsonc"), '{ "name": "game-site" }\n'],
    [
      join(fixtureRoot, "playwright.config.ts"),
      "export default { webServer: { reuseExistingServer: false } };\n",
    ],
    [
      join(fixtureRoot, "package.json"),
      `${JSON.stringify(
        {
          scripts: productionDeployScripts,
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
  } else if (mutation === "maskRootDeployFailure") {
    files.set(
      join(fixtureRoot, "package.json"),
      `${JSON.stringify(
        {
          scripts: {
            deploy:
              "npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && npm run verify:production-config && wrangler deploy",
            "deploy:production:dry":
              "npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && npm run verify:production-config && wrangler deploy --dry-run",
            "deploy:production":
              "npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && npm run verify:production-config || true && wrangler deploy",
          },
        },
        null,
        2,
      )}\n`,
    );
  } else if (mutation === "deployRootBeforeValidation") {
    files.set(
      join(fixtureRoot, "package.json"),
      `${JSON.stringify(
        {
          scripts: {
            deploy:
              "npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && npm run verify:production-config && wrangler deploy",
            "deploy:production:dry":
              "wrangler deploy && npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && npm run verify:production-config && wrangler deploy --dry-run",
            "deploy:production":
              "npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && npm run verify:production-config && wrangler deploy",
          },
        },
        null,
        2,
      )}\n`,
    );
  } else if (mutation === "wrongCanonicalOrigin") {
    files.set(
      join(fixtureRoot, "dist/index.html"),
      '<!doctype html><link rel="canonical" href="https://wrong.testsite.dev/">\n',
    );
  } else if (mutation === "wrongOgSiteName") {
    files.set(
      join(fixtureRoot, "dist/games/demo/index.html"),
      canonicalPage("/games/demo/", { ogSiteName: "Wrong Arcade" }),
    );
  } else if (mutation === "missingOgSiteName") {
    files.set(
      join(fixtureRoot, "dist/games/demo/index.html"),
      canonicalPage("/games/demo/", { includeSiteNameMeta: false }),
    );
  } else if (mutation === "duplicateOgSiteName") {
    files.set(
      join(fixtureRoot, "dist/games/demo/index.html"),
      canonicalPage("/games/demo/", { duplicateSiteNameMeta: true }),
    );
  } else if (mutation === "wrongWebsiteSchemaName") {
    files.set(
      join(fixtureRoot, "dist/index.html"),
      canonicalPage("/", { websiteSchemaName: "GameSite" }),
    );
  } else if (mutation === "wrongWordmarkName") {
    files.set(
      join(fixtureRoot, "dist/index.html"),
      canonicalPage("/", { wordmarkName: "GameSite" }),
    );
  } else if (mutation === "defaultSiteNameInTitle") {
    files.set(
      join(fixtureRoot, "dist/games/demo/index.html"),
      canonicalPage("/games/demo/", { titleSiteName: "GameSite" }),
    );
  } else if (mutation === "wrongTitleSiteName") {
    files.set(
      join(fixtureRoot, "dist/games/demo/index.html"),
      canonicalPage("/games/demo/", { titleSiteName: "Wrong Arcade" }),
    );
  } else if (mutation === "wrongRobotsSitemapOrigin") {
    files.set(
      join(fixtureRoot, "dist/robots.txt"),
      "User-agent: *\nAllow: /\nSitemap: https://wrong.testsite.dev/sitemap-index.xml\n",
    );
  } else if (mutation === "sitemapDraft") {
    files.set(
      join(fixtureRoot, "dist/sitemap-0.xml"),
      sitemap(["/", "/games/demo/", "/games/draft-game/"]),
    );
  } else if (mutation === "sitemapAdmin") {
    files.set(
      join(fixtureRoot, "dist/sitemap-0.xml"),
      sitemap(["/", "/games/demo/", "/admin/"]),
    );
  } else if (mutation === "sitemap404") {
    files.set(
      join(fixtureRoot, "dist/sitemap-0.xml"),
      sitemap(["/", "/games/demo/", "/404.html"]),
    );
  } else if (mutation === "workersDevIndexable") {
    files.set(
      join(fixtureRoot, "public/_headers"),
      "/*\n  X-Content-Type-Options: nosniff\n",
    );
  } else if (mutation === "publicAdScript") {
    files.set(
      join(fixtureRoot, "dist/index.html"),
      `${canonicalPage("/")}<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>\n`,
    );
  } else if (mutation === "adDefaultEnabled") {
    files.set(
      join(fixtureRoot, "src/config/ads.ts"),
      `export const AD_SLOT_IDS = ["home-after-featured"] as const;\nexport const createAdsConfig = () => ({ mode: "placeholder", slots: { "home-after-featured": true } });\n`,
    );
  } else if (mutation === "deployOmitsE2E") {
    files.set(
      join(fixtureRoot, "package.json"),
      `${JSON.stringify(
        {
          scripts: {
            ...productionDeployScripts,
            "deploy:production:dry": productionDeployScripts[
              "deploy:production:dry"
            ].replace(" && npm run test:e2e", ""),
          },
        },
        null,
        2,
      )}\n`,
    );
  } else if (mutation === "deployOmitsDryRun") {
    files.set(
      join(fixtureRoot, "package.json"),
      `${JSON.stringify(
        {
          scripts: {
            ...productionDeployScripts,
            "deploy:production": `${productionPreflight} && npx wrangler deploy`,
          },
        },
        null,
        2,
      )}\n`,
    );
  } else if (mutation === "fakeE2E") {
    files.set(
      join(fixtureRoot, "package.json"),
      `${JSON.stringify(
        {
          scripts: {
            ...productionDeployScripts,
            "test:e2e": "node -e \"console.log('skipped')\"",
          },
        },
        null,
        2,
      )}\n`,
    );
  } else if (mutation === "e2eServerReuseTrue") {
    files.set(
      join(fixtureRoot, "playwright.config.ts"),
      "export default { webServer: { reuseExistingServer: true } };\n",
    );
  } else if (mutation === "e2eServerReuseByCi") {
    files.set(
      join(fixtureRoot, "playwright.config.ts"),
      "export default { webServer: { reuseExistingServer: !process.env.CI } };\n",
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

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...validEnvironment,
  };
  if (mutation === "validSiteName") {
    environment.PUBLIC_SITE_NAME = fixtureSiteName;
  }
  if (mutation === "trimmedSiteName") {
    environment.PUBLIC_SITE_NAME = `  ${fixtureSiteName}  `;
  }
  if (mutation === "missingSiteName") delete environment.PUBLIC_SITE_NAME;
  if (mutation === "blankSiteName") environment.PUBLIC_SITE_NAME = "   ";
  if (mutation === "shortSiteName") environment.PUBLIC_SITE_NAME = "A";
  if (mutation === "longSiteName") {
    environment.PUBLIC_SITE_NAME = "A".repeat(61);
  }
  if (mutation === "defaultSiteName") {
    environment.PUBLIC_SITE_NAME = "GameSite";
  }
  if (mutation === "lowercaseDefaultSiteName") {
    environment.PUBLIC_SITE_NAME = "gamesite";
  }
  if (mutation === "obviousPlaceholderSiteName") {
    environment.PUBLIC_SITE_NAME = "Your Site";
  }
  if (mutation === "siteNamePlaceholder") {
    environment.PUBLIC_SITE_NAME = "Site Name";
  }
  if (mutation === "literalPlaceholderSiteName") {
    environment.PUBLIC_SITE_NAME = "Placeholder";
  }
  if (mutation === "missingSiteUrl") delete environment.PUBLIC_SITE_URL;
  if (mutation === "placeholderSiteUrl") {
    environment.PUBLIC_SITE_URL = "https://example.com";
  }
  if (mutation === "httpSiteUrl") {
    environment.PUBLIC_SITE_URL = "http://arcade.testsite.dev";
  }
  if (mutation === "siteUrlPath") {
    environment.PUBLIC_SITE_URL = `${origins.PUBLIC_SITE_ORIGIN}/games/`;
  }
  if (mutation === "siteUrlQuery") {
    environment.PUBLIC_SITE_URL = `${origins.PUBLIC_SITE_ORIGIN}?preview=1`;
  }
  if (mutation === "siteUrlFragment") {
    environment.PUBLIC_SITE_URL = `${origins.PUBLIC_SITE_ORIGIN}#preview`;
  }
  if (mutation === "siteUrlCredentials") {
    environment.PUBLIC_SITE_URL =
      "https://fixture-user:fixture-pass@arcade.testsite.dev";
  }
  if (mutation === "siteUrlMismatch") {
    environment.PUBLIC_SITE_URL = "https://other.testsite.dev";
  }
  if (mutation === "missingGameOrigins") {
    delete environment.PUBLIC_GAME_ORIGINS;
  }
  if (mutation === "placeholderGameOrigins") {
    environment.PUBLIC_GAME_ORIGINS = "https://play.example.test";
  }
  if (mutation === "gameRoleCollision") {
    environment.PUBLIC_GAME_ORIGINS = origins.PUBLIC_SITE_ORIGIN;
  }
  if (mutation === "gameOriginMismatch") {
    environment.PUBLIC_GAME_ORIGINS = "https://other-play.testsite.dev";
  }
  if (mutation === "productionAdsPlaceholder") {
    environment.PUBLIC_ADS_MODE = "placeholder";
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
    { cwd: projectRoot, encoding: "utf8", env: environment },
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

  it("accepts Real Arcade as an explicit production site name", async () => {
    const result = await runFixture("valid-site-name", "validSiteName");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Repository production configuration verified",
    );
  });

  it("trims an otherwise valid production site name", async () => {
    const result = await runFixture("trimmed-site-name", "trimmedSiteName");

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
