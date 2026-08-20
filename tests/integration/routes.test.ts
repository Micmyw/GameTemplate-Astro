import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const distRoot = resolve(projectRoot, "dist");
const npmCli = process.env.npm_execpath;

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

beforeAll(() => {
  if (!npmCli) {
    throw new Error("npm_execpath is required to run the production build");
  }

  const build = spawnSync(process.execPath, [npmCli, "run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  if (build.status !== 0) {
    throw new Error(
      `${build.error?.message ?? "Build failed"}\n${build.stdout}\n${build.stderr}`,
    );
  }
}, 30_000);

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
        .filter((href): href is string => Boolean(href?.startsWith("/")));

      for (const href of internalUrls) {
        expect(href === "/" || href.endsWith("/"), `${route}: ${href}`).toBe(
          true,
        );
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

  it("links the 404 recovery action to the real games index", () => {
    expect(readRoute("/404.html")).toContain('href="/games/"');
    expect(existsSync(routePath("/games/"))).toBe(true);
  });

  it("renders a player placeholder without an iframe", () => {
    const gameHtml = readRoute("/games/going-balls/");

    expect(gameHtml).toContain("Player coming in a later release");
    expect(gameHtml).not.toMatch(/<iframe\b/i);
  });
});
