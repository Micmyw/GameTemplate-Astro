import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getRobots } from "../../src/pages/robots.txt";

const projectRoot = resolve(import.meta.dirname, "../..");
const buildRoot = mkdtempSync(
  join(projectRoot, "node_modules", ".game-site-seo-"),
);
const mode = "seo-integration";
const environmentPath = resolve(projectRoot, `.env.${mode}`);
const emptyCategoryPath = resolve(
  projectRoot,
  "src/content/categories/seo-empty-archive.md",
);
const draftCategoryPath = resolve(
  projectRoot,
  "src/content/categories/seo-draft-lane.md",
);
const npmCli = process.env.npm_execpath;
const originalEnvironment = existsSync(environmentPath)
  ? readFileSync(environmentPath, "utf8")
  : undefined;

const siteOrigin = "https://arcade.example.test";

const indexableRoutes = [
  "/",
  "/about/",
  "/category/ball-games/",
  "/category/skill-games/",
  "/games/",
  "/games/going-balls/",
  "/games/roll-ball-3d/",
  "/privacy/",
  "/terms/",
] as const;

const routeFile = (route: string): string =>
  route === "/"
    ? resolve(buildRoot, "index.html")
    : resolve(buildRoot, route.slice(1), "index.html");

const readRoute = (route: string): string =>
  readFileSync(routeFile(route), "utf8");

const canonicalFrom = (html: string): string => {
  const matches = [
    ...html.matchAll(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/gi),
  ];
  expect(matches).toHaveLength(1);
  return matches[0]?.[1] ?? "";
};

const metaContent = (
  html: string,
  attribute: "name" | "property",
  key: string,
): string => {
  const pattern = new RegExp(
    `<meta\\b[^>]*${attribute}="${key}"[^>]*content="([^"]+)"[^>]*>`,
    "gi",
  );
  const matches = [...html.matchAll(pattern)];
  expect(matches).toHaveLength(1);
  return matches[0]?.[1] ?? "";
};

const jsonLdFrom = (html: string): Array<Record<string, unknown>> =>
  [
    ...html.matchAll(
      /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);

const listTextFiles = (directory = buildRoot): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTextFiles(path);
    return entry.isFile() && /\.(?:html|txt|xml|svg)$/i.test(entry.name)
      ? [path]
      : [];
  });

const sitemapLocations = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? "");

const assertSiteUrl = (value: unknown) => {
  expect(typeof value).toBe("string");
  const url = new URL(String(value));
  expect(url.protocol).toBe("https:");
  expect(url.origin).toBe(siteOrigin);
};

const emptyCategoryFixture = `---
name: "SEO Empty Archive"
seoTitle: "SEO Empty Archive Browser Game Category"
seoDescription: "A published test category without games that must never produce a route, schema entry, or Sitemap URL in the generated site."
shortDescription: "A build fixture with no published games assigned to this category."
order: 92
featured: true
status: "published"
---
`;

const draftCategoryFixture = `---
name: "SEO Draft Lane"
seoTitle: "SEO Draft Lane Browser Game Category"
seoDescription: "A draft test category that must never produce a route, schema entry, or Sitemap URL in the generated public site."
shortDescription: "A draft build fixture that must remain outside the public catalogue."
order: 93
featured: true
status: "draft"
---
`;

beforeAll(() => {
  if (!npmCli) {
    throw new Error("npm_execpath is required to run the production build");
  }

  writeFileSync(
    environmentPath,
    `PUBLIC_SITE_URL=${siteOrigin}\nPUBLIC_SITE_NAME=TestArcade\n`,
    "utf8",
  );
  writeFileSync(emptyCategoryPath, emptyCategoryFixture, "utf8");
  writeFileSync(draftCategoryPath, draftCategoryFixture, "utf8");

  const environment = { ...process.env };
  delete environment.PUBLIC_SITE_URL;
  delete environment.PUBLIC_SITE_NAME;

  const build = spawnSync(
    process.execPath,
    [
      npmCli,
      "run",
      "build",
      "--",
      "--mode",
      mode,
      "--outDir",
      buildRoot,
      "--force",
    ],
    { cwd: projectRoot, encoding: "utf8", env: environment },
  );

  if (build.status !== 0) {
    throw new Error(
      `${build.error?.message ?? "Build failed"}\n${build.stdout}\n${build.stderr}`,
    );
  }
}, 60_000);

afterAll(() => {
  if (originalEnvironment === undefined) {
    rmSync(environmentPath, { force: true });
  } else {
    writeFileSync(environmentPath, originalEnvironment, "utf8");
  }

  rmSync(emptyCategoryPath, { force: true });
  rmSync(draftCategoryPath, { force: true });
  rmSync(buildRoot, { force: true, recursive: true });
});

describe("page-level SEO output", () => {
  it("uses the custom site origin consistently across metadata", () => {
    for (const route of indexableRoutes) {
      const html = readRoute(route);
      const canonical = canonicalFrom(html);

      expect(canonical).toBe(`${siteOrigin}${route}`);
      expect(metaContent(html, "property", "og:url")).toBe(canonical);
      assertSiteUrl(metaContent(html, "property", "og:image"));
      assertSiteUrl(metaContent(html, "name", "twitter:image"));
    }

    const home = readRoute("/");
    expect(home).toContain("TestArcade");
    expect(home).toContain('<span aria-hidden="true">TA</span>');
    expect(home).not.toContain('<span aria-hidden="true">GS</span>');
  });

  it.each([
    ["/", ["WebSite", "ItemList"]],
    ["/games/going-balls/", ["VideoGame", "BreadcrumbList"]],
    ["/games/roll-ball-3d/", ["VideoGame", "BreadcrumbList"]],
    ["/category/ball-games/", ["CollectionPage", "ItemList", "BreadcrumbList"]],
    [
      "/category/skill-games/",
      ["CollectionPage", "ItemList", "BreadcrumbList"],
    ],
  ])("renders independently parseable schemas on %s", (route, types) => {
    const html = readRoute(route);
    const schemas = jsonLdFrom(html);

    expect(schemas.map((schema) => schema["@type"])).toEqual(types);
    expect(JSON.stringify(schemas)).not.toMatch(
      /LocalBusiness|aggregateRating|reviewCount|publisher|author|undefined/,
    );

    const canonical = canonicalFrom(html);
    const primary = schemas[0];
    expect(primary?.url).toBe(canonical);

    const breadcrumb = schemas.find(
      (schema) => schema["@type"] === "BreadcrumbList",
    );
    if (breadcrumb) {
      const elements = breadcrumb.itemListElement as Array<
        Record<string, unknown>
      >;
      expect(elements.map((item) => item.position)).toEqual(
        elements.map((_item, index) => index + 1),
      );
      expect(elements.at(-1)?.item).toBe(canonical);
      elements.forEach((item) => assertSiteUrl(item.item));
    }

    const itemList = schemas.find((schema) => schema["@type"] === "ItemList");
    if (itemList) {
      const elements = itemList.itemListElement as Array<
        Record<string, unknown>
      >;
      expect(elements.map((item) => item.position)).toEqual(
        elements.map((_item, index) => index + 1),
      );
      elements.forEach((item) => assertSiteUrl(item.url));
    }
  });

  it("limits ItemList schemas to the correct published games", () => {
    const listUrls = (route: string) => {
      const itemList = jsonLdFrom(readRoute(route)).find(
        (schema) => schema["@type"] === "ItemList",
      );
      return (itemList?.itemListElement as Array<Record<string, string>>).map(
        (item) => item.url,
      );
    };

    expect(listUrls("/")).toEqual([
      `${siteOrigin}/games/going-balls/`,
      `${siteOrigin}/games/roll-ball-3d/`,
    ]);
    expect(listUrls("/category/ball-games/")).toEqual([
      `${siteOrigin}/games/going-balls/`,
      `${siteOrigin}/games/roll-ball-3d/`,
    ]);
    expect(listUrls("/category/skill-games/")).toEqual([
      `${siteOrigin}/games/going-balls/`,
    ]);
  });

  it("uses the game cover as the game-page social image", () => {
    const html = readRoute("/games/going-balls/");
    expect(metaContent(html, "property", "og:image")).toMatch(
      /^https:\/\/arcade\.example\.test\/_astro\/going-balls-cover\..+\.svg$/,
    );
  });
});

describe("robots and Sitemap output", () => {
  it("builds the exact robots policy with one same-origin Sitemap", async () => {
    const robotsPath = resolve(buildRoot, "robots.txt");
    expect(existsSync(robotsPath)).toBe(true);

    const robots = readFileSync(robotsPath, "utf8");
    expect(robots).toBe(
      `User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${siteOrigin}/sitemap-index.xml\n`,
    );
    expect(robots.match(/^Sitemap:/gm)).toHaveLength(1);
    expect(robots).not.toContain("Disallow: /games/");
    expect(robots).not.toContain("Disallow: /category/");

    const response = await getRobots({} as never);
    expect(response.headers.get("Content-Type")).toMatch(
      /^text\/plain;\s*charset=utf-8$/i,
    );
  });

  it("matches every Sitemap URL to an indexable page canonical", () => {
    const indexPath = resolve(buildRoot, "sitemap-index.xml");
    expect(existsSync(indexPath)).toBe(true);

    const childUrls = sitemapLocations(readFileSync(indexPath, "utf8"));
    expect(childUrls.length).toBeGreaterThan(0);

    const pageUrls = childUrls.flatMap((childUrl) => {
      const parsed = new URL(childUrl);
      expect(parsed.origin).toBe(siteOrigin);
      const childPath = resolve(buildRoot, parsed.pathname.slice(1));
      expect(existsSync(childPath), relative(buildRoot, childPath)).toBe(true);
      return sitemapLocations(readFileSync(childPath, "utf8"));
    });

    const expectedUrls = indexableRoutes.map(
      (route) => `${siteOrigin}${route}`,
    );
    const canonicalUrls = indexableRoutes.map((route) =>
      canonicalFrom(readRoute(route)),
    );

    expect(new Set(pageUrls).size).toBe(pageUrls.length);
    expect([...pageUrls].sort()).toEqual([...expectedUrls].sort());
    expect([...pageUrls].sort()).toEqual([...canonicalUrls].sort());
    pageUrls.forEach((url) => {
      assertSiteUrl(url);
      expect(new URL(url).pathname).toMatch(/\/$/);
    });
  });

  it("excludes drafts, empty categories, admin, and 404 from routes and Sitemap", () => {
    const textFiles = listTextFiles();
    const output = textFiles
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const sitemapOutput = textFiles
      .filter((file) => /sitemap[^\\/]*\.xml$/i.test(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(output).not.toContain("https://example.com");
    expect(output).not.toContain("/games/obstacle-orbit/");
    expect(output).not.toContain("/category/seo-empty-archive/");
    expect(output).not.toContain("/category/seo-draft-lane/");
    expect(output).not.toContain(`${siteOrigin}/admin/`);
    expect(sitemapOutput).not.toContain(`${siteOrigin}/404.html`);
    expect(existsSync(routeFile("/games/obstacle-orbit/"))).toBe(false);
    expect(existsSync(routeFile("/category/seo-empty-archive/"))).toBe(false);
    expect(existsSync(routeFile("/category/seo-draft-lane/"))).toBe(false);
    expect(existsSync(routeFile("/admin/"))).toBe(false);
  });
});
