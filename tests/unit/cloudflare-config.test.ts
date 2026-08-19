import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type WranglerConfig = {
  assets?: {
    directory?: string;
    not_found_handling?: string;
    html_handling?: string;
  };
  [key: string]: unknown;
};

async function readWranglerConfig(): Promise<WranglerConfig> {
  const source = await readFile(resolve("wrangler.jsonc"), "utf8");
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");

  return JSON.parse(withoutComments) as WranglerConfig;
}

describe("Cloudflare static asset configuration", () => {
  it("serves dist with static 404 and trailing-slash handling", async () => {
    await expect(readWranglerConfig()).resolves.toMatchObject({
      assets: {
        directory: "./dist",
        not_found_handling: "404-page",
        html_handling: "auto-trailing-slash",
      },
    });
  });

  it("does not define a Worker entry point or data binding", async () => {
    const config = await readWranglerConfig();

    expect(config).not.toHaveProperty("main");
    expect(config).not.toHaveProperty("d1_databases");
    expect(config).not.toHaveProperty("kv_namespaces");
    expect(config).not.toHaveProperty("r2_buckets");
  });
});
