import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyDist } from "../../scripts/verify-dist.mjs";

const temporaryDirectories: string[] = [];

async function createDist(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "game-site-dist-"));
  temporaryDirectories.push(root);

  for (const [file, contents] of Object.entries(files)) {
    const destination = join(root, file);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }

  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("verifyDist", () => {
  it("rejects a build without an index page", async () => {
    const distDirectory = await createDist({});

    await expect(verifyDist(distDirectory)).rejects.toThrow(
      "dist/index.html is missing",
    );
  });

  it("rejects an index page without a title", async () => {
    const distDirectory = await createDist({
      "index.html": "<!doctype html><html><head></head><body></body></html>",
    });

    await expect(verifyDist(distDirectory)).rejects.toThrow(
      "dist/index.html must contain a non-empty <title>",
    );
  });

  it("rejects a build without a 404 page", async () => {
    const distDirectory = await createDist({
      "index.html":
        "<!doctype html><html><head><title>GameSite</title></head><body></body></html>",
    });

    await expect(verifyDist(distDirectory)).rejects.toThrow(
      "dist/404.html is missing",
    );
  });

  it("rejects a 404 page without a title", async () => {
    const distDirectory = await createDist({
      "index.html":
        "<!doctype html><html><head><title>GameSite</title></head><body></body></html>",
      "404.html":
        '<!doctype html><html><head><meta name="robots" content="noindex, follow"></head><body></body></html>',
    });

    await expect(verifyDist(distDirectory)).rejects.toThrow(
      "dist/404.html must contain a non-empty <title>",
    );
  });

  it("rejects a 404 page without noindex", async () => {
    const distDirectory = await createDist({
      "index.html":
        "<!doctype html><html><head><title>GameSite</title></head><body></body></html>",
      "404.html":
        "<!doctype html><html><head><title>Page not found</title></head><body></body></html>",
    });

    await expect(verifyDist(distDirectory)).rejects.toThrow(
      "dist/404.html must contain noindex",
    );
  });

  it("rejects duplicate index and 404 titles", async () => {
    const distDirectory = await createDist({
      "index.html":
        "<!doctype html><html><head><title>GameSite</title></head><body></body></html>",
      "404.html":
        '<!doctype html><html><head><title>GameSite</title><meta name="robots" content="noindex, follow"></head><body></body></html>',
    });

    await expect(verifyDist(distDirectory)).rejects.toThrow(
      "dist/404.html must use a title distinct from dist/index.html",
    );
  });

  it("accepts titled index and noindexed 404 pages", async () => {
    const distDirectory = await createDist({
      "index.html":
        "<!doctype html><html><head><title>GameSite</title></head><body></body></html>",
      "404.html":
        '<!doctype html><html><head><title>Page not found</title><meta name="robots" content="noindex, follow"></head><body></body></html>',
    });

    await expect(verifyDist(distDirectory)).resolves.toEqual({
      checkedFiles: ["index.html", "404.html"],
    });
  });
});
