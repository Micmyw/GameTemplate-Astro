import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  ADS,
  AD_SLOT_IDS,
  createAdsConfig,
  isAdSlotEnabled,
} from "../../src/config/ads";

const projectRoot = resolve(import.meta.dirname, "../..");
const invalidPagePath = resolve(
  projectRoot,
  "src/pages/__invalid-ad-slot.astro",
);
const npmCli = process.env.npm_execpath;

afterEach(() => {
  rmSync(invalidPagePath, { force: true });
});

describe("centralized advertising configuration", () => {
  it("defaults every approved slot to disabled", () => {
    expect(ADS.mode).toBe("disabled");
    expect(AD_SLOT_IDS).toEqual([
      "home-after-featured",
      "game-before-player",
      "game-after-content",
      "category-after-grid",
    ]);

    for (const slot of AD_SLOT_IDS) {
      expect(isAdSlotEnabled(slot, ADS), slot).toBe(false);
    }
  });

  it("enables only the local placeholder presentation mode", () => {
    const config = createAdsConfig({ PUBLIC_ADS_MODE: "placeholder" });

    expect(config.mode).toBe("placeholder");
    for (const slot of AD_SLOT_IDS) {
      expect(isAdSlotEnabled(slot, config), slot).toBe(true);
    }
  });

  it("rejects unsupported advertising modes instead of guessing", () => {
    expect(() => createAdsConfig({ PUBLIC_ADS_MODE: "vendor-script" })).toThrow(
      /PUBLIC_ADS_MODE.*disabled.*placeholder/i,
    );
  });

  it("makes an unknown AdSlot ID fail Astro type checking", () => {
    if (!npmCli) {
      throw new Error("npm_execpath is required to run Astro check");
    }

    writeFileSync(
      invalidPagePath,
      `---\nimport AdSlot from "../components/ads/AdSlot.astro";\n---\n<AdSlot slot="not-a-slot" />\n`,
      "utf8",
    );

    const result = spawnSync(process.execPath, [npmCli, "run", "check"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status, output).toBe(1);
    expect(output).toContain("not-a-slot");
    expect(output).toMatch(/not assignable|AdSlotId/i);
  }, 30_000);
});
