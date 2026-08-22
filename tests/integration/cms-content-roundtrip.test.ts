import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const contentPath = resolve(projectRoot, "src/content/games/cms-roundtrip.md");
const distPath = resolve(projectRoot, "dist");
const draftRoutePath = resolve(distPath, "games/cms-roundtrip/index.html");
const npmCli = process.env.npm_execpath;

const cmsShapedGame = `---
title: "CMS Roundtrip"
seoTitle: "CMS Roundtrip Draft Browser Game Test"
seoDescription: "Verify that Decap CMS image paths, relations, controls, source metadata, and dates pass through the live Astro content schema unchanged."
shortDescription: "A temporary draft that validates the complete Decap authoring shape."
coverImage: "../../assets/images/games/going-balls-cover.svg"
coverAlt: "A blue ball used for the CMS round-trip fixture"
screenshots:
  - image: "../../assets/images/games/roll-ball-3d-cover.svg"
    alt: "A second ball-game image used by the CMS screenshot field"
embedUrl: "https://play.example.com/cms-roundtrip/index.html"
categories:
  - "ball-games"
  - "skill-games"
tags:
  - "cms"
  - "roundtrip"
controls:
  - input: "Arrow keys"
    action: "Move the fixture ball left or right"
featured: false
mobileSupport: "partial"
orientation: "both"
loadMode: "click"
aspectRatio: "16/9"
status: "draft"
publishedAt: 2026-08-20
updatedAt: 2026-08-21
source:
  name: "CMS round-trip fixture"
  url: "https://example.com/cms-roundtrip-source"
  license: "Synthetic test content"
relatedGames:
  - "going-balls"
---

This Markdown body proves that Decap's body widget remains compatible with Astro content loading without a manual rewrite.
`;

const runNpm = (script: "check" | "build") => {
  if (!npmCli) throw new Error("npm_execpath is required for CMS round-trip");
  const result = spawnSync(process.execPath, [npmCli, "run", script], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env },
  });

  if (result.status !== 0) {
    throw new Error(
      `npm run ${script} failed\n${result.stdout}\n${result.stderr}`,
    );
  }

  return `${result.stdout}\n${result.stderr}`;
};

describe("Decap CMS content round-trip", () => {
  it("passes a complete CMS-shaped draft through Astro without publishing it", async () => {
    await writeFile(contentPath, cmsShapedGame, "utf8");

    try {
      const checkOutput = runNpm("check");
      const buildOutput = runNpm("build");

      expect(checkOutput).toContain("0 errors");
      expect(buildOutput).toContain("Complete!");
      expect(existsSync(draftRoutePath)).toBe(false);
    } finally {
      await rm(contentPath, { force: true });
      await rm(distPath, { force: true, recursive: true });
    }
  }, 120_000);
});
