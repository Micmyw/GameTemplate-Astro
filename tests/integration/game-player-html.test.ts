import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { load } from "cheerio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const buildRoot = mkdtempSync(
  join(projectRoot, "node_modules", ".game-player-html-"),
);
const eagerFixturePath = resolve(
  projectRoot,
  "src/content/games/eager-player-test.md",
);
const npmCli = process.env.npm_execpath;

const eagerFixture = `---
title: "Eager Player Test"
seoTitle: "Eager Player Test - Secure Initial Frame"
seoDescription: "Verify that an eager browser game emits one secured initial frame while preserving readable controls, metadata, and page content in static HTML."
shortDescription: "Exercise the eager GamePlayer output without changing a published example game."
coverImage: "../../assets/images/games/roll-ball-3d-cover.svg"
coverAlt: "An orange ball on a test course for the eager player"
screenshots: []
embedUrl: "https://play.example.com/eager-player-test/"
categories:
  - "ball-games"
tags:
  - "fixture"
controls:
  - input: "Arrow keys"
    action: "Move the test ball left or right"
featured: false
mobileSupport: "yes"
orientation: "landscape"
loadMode: "eager"
aspectRatio: "16/9"
status: "published"
publishedAt: 2026-08-20
updatedAt: 2026-08-20
source:
  name: "Synthetic test fixture"
  url: "https://example.com/"
  license: "Created for automated testing"
relatedGames: []
---

This fixture verifies eager GamePlayer output without publishing an eager example game.
`;

const routeFile = (route: string): string =>
  resolve(buildRoot, route.replace(/^\//, ""), "index.html");

const readRoute = (route: string): string =>
  readFileSync(routeFile(route), "utf8");

beforeAll(() => {
  if (!npmCli) {
    throw new Error("npm_execpath is required to run the production build");
  }

  writeFileSync(eagerFixturePath, eagerFixture, "utf8");

  const environment = {
    ...process.env,
    PUBLIC_GAME_ORIGINS: "https://play.example.com",
    PUBLIC_SITE_URL: "https://player-html.example.test",
  };

  let build: ReturnType<typeof spawnSync>;
  try {
    build = spawnSync(
      process.execPath,
      [npmCli, "run", "build", "--", "--outDir", buildRoot, "--force"],
      { cwd: projectRoot, encoding: "utf8", env: environment },
    );
  } finally {
    rmSync(eagerFixturePath, { force: true });
  }

  if (build.status !== 0) {
    throw new Error(
      `${build.error?.message ?? "Build failed"}\n${build.stdout}\n${build.stderr}`,
    );
  }
}, 60_000);

afterAll(() => {
  rmSync(eagerFixturePath, { force: true });
  rmSync(buildRoot, { force: true, recursive: true });
});

describe("GamePlayer static HTML", () => {
  it("keeps a click-mode game readable while deferring the iframe", () => {
    const html = readRoute("/games/going-balls/");
    const $ = load(html);
    const player = $("[data-game-player]");

    expect(player).toHaveLength(1);
    expect(player.attr("data-load-mode")).toBe("click");
    expect(player.attr("data-src")).toBe(
      "https://play.example.com/going-balls/",
    );
    expect(player.attr("style")).toMatch(/16\s*\/\s*9/);
    expect(player.find('button[data-game-play][type="button"]').text()).toBe(
      "Play Going Balls",
    );
    expect(
      player.find(
        'img[alt="A blue ball crossing a suspended obstacle course"]',
      ),
    ).toHaveLength(1);
    expect(player.find("iframe")).toHaveLength(0);
    expect(player.find("[data-game-status][role='status']")).toHaveLength(1);
    expect(player.find("[data-game-status]").attr("aria-live")).toBe("polite");
    expect(player.find("button:not([type='button'])")).toHaveLength(0);
    expect(
      html.match(/https:\/\/play\.example\.com\/going-balls\//g),
    ).toHaveLength(1);

    expect($("h1").text()).toBe("Going Balls");
    expect($(".game-copy .prose").text()).toContain(
      "Going Balls is about preserving momentum",
    );
    expect($("#controls-heading").text()).toBe("Controls");
    expect($('.game-info-strip a[href="/category/ball-games/"]')).toHaveLength(
      1,
    );
    expect(() =>
      $("script[type='application/ld+json']")
        .toArray()
        .map((element) => JSON.parse($(element).text())),
    ).not.toThrow();
  });

  it("emits one eager iframe with the exact shared security policy", () => {
    expect(existsSync(routeFile("/games/eager-player-test/"))).toBe(true);
    const $ = load(readRoute("/games/eager-player-test/"));
    const player = $("[data-game-player]");
    const frame = player.find("iframe");
    const observer = frame.prev("script[data-game-frame-observer]");

    expect(player).toHaveLength(1);
    expect(player.attr("data-load-mode")).toBe("eager");
    expect(frame).toHaveLength(1);
    expect(observer).toHaveLength(1);
    expect(frame.attr("src")).toBe(
      "https://play.example.com/eager-player-test/",
    );
    expect(frame.attr("title")).toBe("Play Eager Player Test");
    expect(frame.attr("allow")).toBe("fullscreen; autoplay; gamepad");
    expect(frame.attr("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-pointer-lock",
    );
    expect(frame.attr("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(frame.is("[allowfullscreen]")).toBe(true);
    expect(frame.is("[srcdoc]")).toBe(false);
  });
});
