import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const distRoot = resolve(projectRoot, "dist");
const npmCli = process.env.npm_execpath;
const emptyCategoryPath = resolve(
  projectRoot,
  "src/content/categories/empty-archive.md",
);
const draftCategoryPath = resolve(
  projectRoot,
  "src/content/categories/draft-lane.md",
);

const emptyCategoryFixture = `---
name: "Empty Archive"
seoTitle: "Empty Archive Browser Game Category"
seoDescription: "A deliberately empty published category used to verify that public pages never create links to routes without published games."
shortDescription: "A published category fixture without any published games assigned to it."
order: 90
featured: true
status: "published"
---
`;

const draftCategoryFixture = `---
name: "Draft Lane"
seoTitle: "Draft Lane Browser Game Category"
seoDescription: "A deliberately unpublished category used to verify that draft taxonomy never appears in public routes or navigation."
shortDescription: "A draft category fixture that must remain absent from every public page."
order: 91
featured: true
status: "draft"
---
`;

const routeFiles = {
  "/": "index.html",
  "/games/": "games/index.html",
  "/games/going-balls/": "games/going-balls/index.html",
  "/games/roll-ball-3d/": "games/roll-ball-3d/index.html",
  "/category/ball-games/": "category/ball-games/index.html",
  "/category/skill-games/": "category/skill-games/index.html",
  "/about/": "about/index.html",
  "/privacy/": "privacy/index.html",
  "/terms/": "terms/index.html",
  "/404.html": "404.html",
} as const;

const routePath = (route: keyof typeof routeFiles) =>
  resolve(distRoot, routeFiles[route]);

const readRoute = (route: keyof typeof routeFiles) =>
  readFileSync(routePath(route), "utf8");

const listHtmlFiles = (directory = distRoot): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) return listHtmlFiles(path);
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
  });

const buildSite = (siteName?: string) => {
  if (!npmCli) {
    throw new Error("npm_execpath is required to run the production build");
  }

  const env = { ...process.env };
  if (siteName) env.PUBLIC_SITE_NAME = siteName;
  else delete env.PUBLIC_SITE_NAME;

  const build = spawnSync(process.execPath, [npmCli, "run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    env,
  });

  if (build.status !== 0) {
    throw new Error(
      `${build.error?.message ?? "Build failed"}\n${build.stdout}\n${build.stderr}`,
    );
  }
};

beforeAll(() => {
  writeFileSync(emptyCategoryPath, emptyCategoryFixture, "utf8");
  writeFileSync(draftCategoryPath, draftCategoryFixture, "utf8");
  buildSite();
}, 30_000);

afterAll(() => {
  rmSync(emptyCategoryPath, { force: true });
  rmSync(draftCategoryPath, { force: true });
});

describe("static route generation", () => {
  it.each(Object.entries(routeFiles))("builds %s", (_route, file) => {
    expect(existsSync(resolve(distRoot, file))).toBe(true);
  });

  it("does not build the draft game route", () => {
    expect(
      existsSync(resolve(distRoot, "games/obstacle-orbit/index.html")),
    ).toBe(false);
  });

  it("uses trailing slashes for every internal anchor URL", () => {
    for (const route of Object.keys(routeFiles) as Array<
      keyof typeof routeFiles
    >) {
      const anchors = [
        ...readRoute(route).matchAll(/<a\b[^>]*href="([^"]+)"/g),
      ];
      const internalUrls = anchors
        .map((match) => match[1])
        .filter((href): href is string =>
          Boolean(href?.startsWith("/") && !href.startsWith("//")),
        );

      for (const href of internalUrls) {
        const pathname = new URL(href, "https://example.test").pathname;
        expect(
          pathname === "/" ||
            pathname === "/404.html" ||
            pathname.endsWith("/"),
          `${route}: ${href}`,
        ).toBe(true);
      }
    }
  });

  it("resolves every internal anchor to a generated HTML file", () => {
    for (const htmlFile of listHtmlFiles()) {
      const html = readFileSync(htmlFile, "utf8");
      const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)];

      for (const [, href] of anchors) {
        if (
          !href ||
          href.startsWith("#") ||
          !href.startsWith("/") ||
          href.startsWith("//")
        ) {
          continue;
        }

        const pathname = new URL(href, "https://example.test").pathname;
        const target =
          pathname === "/"
            ? resolve(distRoot, "index.html")
            : pathname === "/404.html"
              ? resolve(distRoot, "404.html")
              : resolve(distRoot, pathname.slice(1), "index.html");

        expect(
          existsSync(target),
          `${relative(projectRoot, htmlFile)} -> ${href}`,
        ).toBe(true);
      }
    }
  });

  it("renders the unique game body directly into each game HTML file", () => {
    expect(readRoute("/games/going-balls/")).toContain(
      "Going Balls is about preserving momentum",
    );
    expect(readRoute("/games/roll-ball-3d/")).toContain(
      "Roll Ball 3D turns each course into a sequence of route choices",
    );
  });

  it("renders human-readable category names on game cards", () => {
    expect(readRoute("/category/ball-games/")).toContain(
      'href="/category/skill-games/">Skill Games</a>',
    );
  });

  it("gives every public page one non-empty title and exactly one H1", () => {
    for (const route of Object.keys(routeFiles) as Array<
      keyof typeof routeFiles
    >) {
      const html = readRoute(route);
      const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
      const h1Count = html.match(/<h1\b/gi)?.length ?? 0;

      expect(title, `${route} title`).toBeTruthy();
      expect(h1Count, `${route} H1 count`).toBe(1);
    }
  });

  it("keeps draft content out of every listing and recommendation", () => {
    const publicHtml = [
      readRoute("/"),
      readRoute("/games/"),
      readRoute("/games/going-balls/"),
      readRoute("/games/roll-ball-3d/"),
      readRoute("/category/ball-games/"),
      readRoute("/category/skill-games/"),
    ].join("\n");

    expect(publicHtml).not.toContain("Obstacle Orbit");
    expect(publicHtml).not.toContain("/games/obstacle-orbit/");
  });

  it("omits empty and draft categories while keeping populated categories", () => {
    const publicHtml = listHtmlFiles()
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(
      existsSync(resolve(distRoot, "category/empty-archive/index.html")),
    ).toBe(false);
    expect(
      existsSync(resolve(distRoot, "category/draft-lane/index.html")),
    ).toBe(false);
    expect(publicHtml).not.toContain("/category/empty-archive/");
    expect(publicHtml).not.toContain("/category/draft-lane/");
    expect(readRoute("/")).toContain('href="/category/ball-games/"');
    expect(readRoute("/")).toContain('href="/category/skill-games/"');
  });

  it("does not hard-code a category route in the site header", () => {
    const header = readRoute("/").match(
      /<header class="site-header">[\s\S]*?<\/header>/,
    )?.[0];

    expect(header).toBeTruthy();
    expect(header).not.toContain("/category/ball-games/");
    expect(header).not.toContain("/category/empty-archive/");
    expect(header).not.toContain("/category/draft-lane/");
  });

  it("links the 404 recovery action to the real games index", () => {
    expect(readRoute("/404.html")).toContain('href="/games/"');
    expect(existsSync(routePath("/games/"))).toBe(true);
  });

  it("renders a player placeholder without an iframe", () => {
    const gameHtml = readRoute("/games/going-balls/");

    expect(gameHtml).toContain("Player coming in a later release");
    expect(gameHtml).not.toMatch(/<iframe\b/i);
  });

  it("uses PUBLIC_SITE_NAME across every generated public page", () => {
    buildSite("TestArcade");

    for (const [route] of Object.entries(routeFiles) as Array<
      [keyof typeof routeFiles, string]
    >) {
      const html = readRoute(route);
      const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];

      expect(title, `${route} title`).toContain("TestArcade");
      expect(html, route).toContain("TestArcade");
      expect(html, route).not.toContain("GameSite");
    }
  }, 30_000);
});
