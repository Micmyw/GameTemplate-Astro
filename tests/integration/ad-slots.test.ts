import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { load } from "cheerio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const npmCli = process.env.npm_execpath;
const buildRoots: string[] = [];

const buildSite = (mode?: "placeholder") => {
  if (!npmCli) {
    throw new Error("npm_execpath is required to run the production build");
  }

  const outputRoot = mkdtempSync(join(projectRoot, "node_modules", ".ads-"));
  buildRoots.push(outputRoot);

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PUBLIC_GAME_ORIGINS: "https://play.example.com",
    PUBLIC_SITE_URL: "https://ads.example.test",
  };
  if (mode) environment.PUBLIC_ADS_MODE = mode;
  else delete environment.PUBLIC_ADS_MODE;

  const build = spawnSync(
    process.execPath,
    [npmCli, "run", "build", "--", "--outDir", outputRoot, "--force"],
    { cwd: projectRoot, encoding: "utf8", env: environment },
  );

  if (build.status !== 0) {
    throw new Error(
      `${build.error?.message ?? "Build failed"}\n${build.stdout}\n${build.stderr}`,
    );
  }

  return outputRoot;
};

const readPage = (root: string, path: string) =>
  readFileSync(resolve(root, ...path.split("/")), "utf8");

let disabledBuildRoot: string;
let placeholderBuildRoot: string;

beforeAll(() => {
  disabledBuildRoot = buildSite();
  placeholderBuildRoot = buildSite("placeholder");
}, 90_000);

afterAll(() => {
  for (const root of buildRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("centralized ad slots in static HTML", () => {
  const publicPages = [
    "index.html",
    "games/going-balls/index.html",
    "category/ball-games/index.html",
  ] as const;

  it("renders no wrapper, label, or layout hook when ads are disabled", () => {
    for (const page of publicPages) {
      const html = readPage(disabledBuildRoot, page);
      const $ = load(html);

      expect($("[data-ad-slot]"), page).toHaveLength(0);
      expect($(".ad-slot"), page).toHaveLength(0);
      expect($("body").text(), page).not.toContain("Advertisement");
    }
  });

  it("renders the four named Advertisement placeholders when enabled", () => {
    const home = load(readPage(placeholderBuildRoot, "index.html"));
    const game = load(
      readPage(placeholderBuildRoot, "games/going-balls/index.html"),
    );
    const category = load(
      readPage(placeholderBuildRoot, "category/ball-games/index.html"),
    );

    expect(home('[data-ad-slot="home-after-featured"]')).toHaveLength(1);
    expect(game('[data-ad-slot="game-before-player"]')).toHaveLength(1);
    expect(game('[data-ad-slot="game-after-content"]')).toHaveLength(1);
    expect(category('[data-ad-slot="category-after-grid"]')).toHaveLength(1);

    for (const $ of [home, game, category]) {
      $("[data-ad-slot]").each((_index, element) => {
        expect($(element).text().trim()).toBe("Advertisement");
        expect($(element).attr("aria-label")).toBe("Advertisement");
      });
    }
  });

  it("places each enabled slot at its named page boundary", () => {
    const home = load(readPage(placeholderBuildRoot, "index.html"));
    const game = load(
      readPage(placeholderBuildRoot, "games/going-balls/index.html"),
    );
    const category = load(
      readPage(placeholderBuildRoot, "category/ball-games/index.html"),
    );

    expect(
      home("#featured-heading")
        .closest("section")
        .find(".game-grid")
        .next()
        .attr("data-ad-slot"),
    ).toBe("home-after-featured");

    const beforePlayer = game('[data-ad-slot="game-before-player"]');
    expect(beforePlayer.prev().is(".game-detail-header")).toBe(true);
    expect(beforePlayer.next().is("[data-game-player]")).toBe(true);
    expect(
      game("article.game-detail").children().last().attr("data-ad-slot"),
    ).toBe("game-after-content");

    expect(
      category(".catalogue-section .game-grid").next().attr("data-ad-slot"),
    ).toBe("category-after-grid");
  });

  it("does not add scripts to enabled advertising placeholders", () => {
    for (const page of publicPages) {
      const $ = load(readPage(placeholderBuildRoot, page));

      expect($("[data-ad-slot] script"), page).toHaveLength(0);
      expect(
        $('script[src*="googlesyndication"], script[src*="doubleclick"]'),
        page,
      ).toHaveLength(0);
    }
  });
});
