import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createSiteConfig, siteInitials } from "../../src/config/site";
import {
  DEFAULT_SITE_ORIGIN,
  normalizeSiteOrigin,
} from "../../src/lib/site-origin";
import { createAstroConfig, resolveAstroMode } from "../../astro.config.mjs";

const projectRoot = resolve(import.meta.dirname, "../..");
const testMode = "site-config-test";
const testEnvironmentPath = resolve(projectRoot, `.env.${testMode}`);

afterAll(async () => {
  await rm(testEnvironmentPath, { force: true });
});

describe("site origin configuration", () => {
  it("normalizes a valid HTTPS origin", () => {
    expect(normalizeSiteOrigin("https://arcade.example.test/").origin).toBe(
      "https://arcade.example.test",
    );
  });

  it.each([
    "http://arcade.example.test",
    "https://user:password@arcade.example.test",
    "https://arcade.example.test/catalogue/",
    "https://arcade.example.test/?preview=1",
    "https://arcade.example.test/#top",
  ])("rejects unsafe or non-origin PUBLIC_SITE_URL value %s", (value) => {
    expect(() => normalizeSiteOrigin(value)).toThrow(/PUBLIC_SITE_URL/);
  });

  it("does not echo rejected PUBLIC_SITE_URL credentials", () => {
    const marker = "SYNTHETIC_SITE_ORIGIN_CREDENTIAL_MARKER";
    let thrown: unknown;

    try {
      normalizeSiteOrigin(`https://fixture-user:${marker}@arcade.example.test`);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/PUBLIC_SITE_URL.*credentials/i);
    expect((thrown as Error).message).not.toContain(marker);
    expect((thrown as Error).message).not.toContain("fixture-user");
  });

  it("uses an explicit documented default when no URL is configured", () => {
    expect(createSiteConfig({}).url.origin).toBe(DEFAULT_SITE_ORIGIN);
  });

  it("loads the current Astro mode from the project root", async () => {
    await writeFile(
      testEnvironmentPath,
      "PUBLIC_SITE_URL=https://arcade.example.test\nPUBLIC_SITE_NAME=TestArcade\n",
      "utf8",
    );

    const config = createAstroConfig(testMode, projectRoot);
    const site = createSiteConfig({
      PUBLIC_SITE_URL: "https://arcade.example.test",
      PUBLIC_SITE_NAME: "TestArcade",
    });

    expect(config.site).toBe(site.url.origin);
    expect(site.name).toBe("TestArcade");
  });

  it("resolves explicit Astro modes before the command environment", () => {
    expect(
      resolveAstroMode(
        ["node", "astro", "build", "--mode", "staging"],
        "production",
      ),
    ).toBe("staging");
    expect(
      resolveAstroMode(
        ["node", "astro", "build", "--mode=preview"],
        "production",
      ),
    ).toBe("preview");
    expect(resolveAstroMode(["node", "astro", "build"], "production")).toBe(
      "production",
    );
  });
});

describe("siteInitials", () => {
  it.each([
    ["GameSite", "GS"],
    ["TestArcade", "TA"],
    ["Test Arcade", "TA"],
    ["arcade", "AR"],
  ])("derives at most two characters from %s", (name, expected) => {
    expect(siteInitials(name)).toBe(expected);
  });
});
