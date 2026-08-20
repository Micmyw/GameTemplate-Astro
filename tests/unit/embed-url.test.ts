import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertCrossOrigin,
  parseAllowedGameOrigins,
  validateEmbedUrl,
} from "../../src/lib/embed-url";

const projectRoot = resolve(import.meta.dirname, "../..");

describe("parseAllowedGameOrigins", () => {
  it("normalizes, deduplicates, and preserves the first origin order", () => {
    const origins = parseAllowedGameOrigins(
      " https://PLAY.example.com:443/, https://games.example.com, https://play.example.com ",
    );

    expect(origins.map((origin) => origin.href)).toEqual([
      "https://play.example.com/",
      "https://games.example.com/",
    ]);
  });

  it.each([
    ["an empty list", ""],
    ["only whitespace", "  ,  "],
    ["a relative URL", "play.example.com"],
    ["HTTP", "http://play.example.com"],
    ["JavaScript", "javascript:alert(1)"],
    ["data", "data:text/html,game"],
    ["blob", "blob:https://play.example.com/id"],
    ["credentials", "https://user:password@play.example.com"],
    ["a path", "https://play.example.com/games/"],
    ["a query", "https://play.example.com/?preview=1"],
    ["an empty query", "https://play.example.com/?"],
    ["a fragment", "https://play.example.com/#player"],
    ["an empty fragment", "https://play.example.com/#"],
  ])("rejects %s in the allowlist", (_name, raw) => {
    expect(() => parseAllowedGameOrigins(raw)).toThrow(/PUBLIC_GAME_ORIGINS/);
  });
});

describe("validateEmbedUrl", () => {
  const allowedOrigins = parseAllowedGameOrigins(
    "https://play.example.com,https://play.example.com:8443",
  );

  it("accepts an exact allowed HTTPS origin, trailing slash, and safe query", () => {
    const parsed = validateEmbedUrl(
      "https://PLAY.example.com:443/going-balls/?locale=en&quality=high",
      allowedOrigins,
    );

    expect(parsed.href).toBe(
      "https://play.example.com/going-balls/?locale=en&quality=high",
    );
  });

  it.each([
    ["malformed", "not a URL"],
    ["HTTP", "http://play.example.com/going-balls/"],
    ["JavaScript", "javascript:alert(1)"],
    ["data", "data:text/html,game"],
    ["blob", "blob:https://play.example.com/id"],
    ["credentials", "https://user:password@play.example.com/going-balls/"],
    ["a fragment", "https://play.example.com/going-balls/#player"],
    ["an empty fragment", "https://play.example.com/going-balls/#"],
    ["a missing trailing slash", "https://play.example.com/going-balls"],
    ["an unlisted origin", "https://games.example.com/going-balls/"],
    ["a lookalike hostname", "https://play.example.com.evil.test/game/"],
    ["an unlisted subdomain", "https://cdn.play.example.com/game/"],
    ["an unlisted port", "https://play.example.com:9443/game/"],
  ])("rejects %s", (_name, raw) => {
    expect(() => validateEmbedUrl(raw, allowedOrigins)).toThrow(/embedUrl/);
  });

  it("matches allowed origins by exact normalized origin, including ports", () => {
    expect(
      validateEmbedUrl("https://play.example.com:8443/game/", allowedOrigins)
        .origin,
    ).toBe("https://play.example.com:8443");
  });
});

describe("assertCrossOrigin", () => {
  const siteOrigin = new URL("https://example.com");

  it("returns a game URL hosted on a distinct origin", () => {
    const gameUrl = new URL("https://play.example.com/game/");

    expect(assertCrossOrigin(gameUrl, siteOrigin)).toBe(gameUrl);
  });

  it("rejects a game URL on the main site origin", () => {
    expect(() =>
      assertCrossOrigin(new URL("https://example.com/game/"), siteOrigin),
    ).toThrow(/different.*origin|same.*origin/i);
  });
});

describe("Astro command environment", () => {
  it("loads a temporary PUBLIC_GAME_ORIGINS value during check and build", async () => {
    const npmCli = process.env.npm_execpath;
    expect(npmCli).toBeTruthy();

    const fixturePath = resolve(
      projectRoot,
      "src/content/games/__embed-origin-environment.md",
    );
    const templatePath = resolve(
      projectRoot,
      "src/content/games/obstacle-orbit.md",
    );
    const outputPath = resolve(
      projectRoot,
      "node_modules/.embed-origin-command-test",
    );
    const template = await readFile(templatePath, "utf8");
    const fixture = template.replace(
      "https://play.example.com/obstacle-orbit/",
      "https://player.integration.test/environment-proof/",
    );
    const environment = {
      ...process.env,
      PUBLIC_GAME_ORIGINS:
        "https://play.example.com,https://player.integration.test",
    };

    const runNpm = (argumentsList: string[]) =>
      spawnSync(process.execPath, [npmCli!, ...argumentsList], {
        cwd: projectRoot,
        encoding: "utf8",
        env: environment,
      });

    await writeFile(fixturePath, fixture, "utf8");

    try {
      const check = runNpm(["run", "check"]);
      const checkOutput = `${check.stdout ?? ""}\n${check.stderr ?? ""}\n${check.error?.message ?? ""}`;
      expect(check.status, checkOutput).toBe(0);

      const build = runNpm([
        "run",
        "build",
        "--",
        "--outDir",
        outputPath,
        "--force",
      ]);
      const buildOutput = `${build.stdout ?? ""}\n${build.stderr ?? ""}\n${build.error?.message ?? ""}`;
      expect(build.status, buildOutput).toBe(0);
    } finally {
      await Promise.all([
        rm(fixturePath, { force: true }),
        rm(outputPath, { force: true, recursive: true }),
      ]);
    }
  }, 30_000);
});
