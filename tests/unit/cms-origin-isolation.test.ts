import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { load } from "cheerio";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;

const projectRoot = resolve(import.meta.dirname, "../..");
const cmsAdminRoot = resolve(projectRoot, "apps/cms-admin");
const cmsAdminPublic = resolve(cmsAdminRoot, "public");

const readJson = async (path: string): Promise<JsonRecord> => {
  const jsonc = await readFile(path, "utf8");
  return JSON.parse(jsonc.replace(/,\s*([}\]])/g, "$1")) as JsonRecord;
};

const listFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];

  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      if (entry.isFile()) files.push(path);
    }
  };

  await visit(root);
  return files;
};

const readSourceTree = async (roots: string[]): Promise<string> => {
  const sourceExtensions = new Set([
    ".astro",
    ".css",
    ".html",
    ".js",
    ".mjs",
    ".ts",
    ".txt",
    ".yml",
    ".yaml",
  ]);
  const files = (
    await Promise.all(
      roots.map((root) => listFiles(resolve(projectRoot, root))),
    )
  )
    .flat()
    .filter((file) => sourceExtensions.has(extname(file).toLowerCase()));

  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join(
    "\n",
  );
};

describe("CMS token Origin isolation", () => {
  it("removes the production CMS directory from the public site", () => {
    expect(existsSync(resolve(projectRoot, "public/admin"))).toBe(false);
  });

  it("keeps the Decap client out of every main-site public and source file", async () => {
    const publicSiteSource = (await readSourceTree(["public", "src"]))
      .toLowerCase()
      .replaceAll(" ", "");

    expect(publicSiteSource).not.toContain("decap-cms");
    expect(publicSiteSource).not.toContain("unpkg.com/decap");
  });

  it("defines CMS Admin as a binding-free Wrangler Static Assets app", async () => {
    const packageJson = await readJson(resolve(cmsAdminRoot, "package.json"));
    const wrangler = await readJson(resolve(cmsAdminRoot, "wrangler.jsonc"));
    const dependencies = packageJson.devDependencies as JsonRecord;
    const scripts = packageJson.scripts as JsonRecord;

    expect(packageJson.private).toBe(true);
    expect(packageJson.engines).toEqual({ node: ">=24 <25" });
    expect(dependencies.wrangler).toBe("4.124.0");
    expect(scripts).toMatchObject({
      dev: "wrangler dev --ip 127.0.0.1 --port 4322",
      "format:check": "prettier --ignore-path ../../.prettierignore --check .",
      "verify:production-config": "node scripts/verify-production-config.mjs",
      "deploy:dry": "wrangler deploy --dry-run",
      "deploy:production:dry":
        "npm run format:check && npm run test:headers && npm run verify:production-config && wrangler deploy --dry-run --env production",
      "deploy:production":
        "npm run format:check && npm run test:headers && npm run verify:production-config && wrangler deploy --env production",
    });
    expect(scripts).not.toHaveProperty("deploy");
    expect(wrangler).toMatchObject({
      name: "game-site-cms-admin",
      compatibility_date: "2026-08-22",
      assets: { directory: "./public" },
      env: {
        production: {
          name: "game-site-cms-admin-production",
          assets: { directory: "./public" },
        },
      },
    });
    for (const forbidden of [
      "main",
      "vars",
      "kv_namespaces",
      "d1_databases",
      "r2_buckets",
      "durable_objects",
      "services",
      "queues",
      "vectorize",
      "workflows",
    ]) {
      expect(wrangler).not.toHaveProperty(forbidden);
    }
  });

  it("runs Astro, CMS Admin, and the local backend on separate ports", async () => {
    const rootPackage = await readJson(resolve(projectRoot, "package.json"));
    const scripts = rootPackage.scripts as JsonRecord;

    expect(scripts.dev).toBe("run-p dev:astro dev:cms-admin dev:cms-proxy");
    expect(scripts["dev:astro"]).toContain("--port 4321");
    expect(scripts["dev:cms-admin"]).toBe(
      "npm --prefix apps/cms-admin run dev",
    );
    expect(scripts["dev:cms-proxy"]).toContain("ORIGIN=http://127.0.0.1:4322");
  });

  it("contains no active legacy CMS site Origin binding", async () => {
    const legacyBinding = ["CMS", "SITE", "ORIGIN"].join("_");
    const activeWorkerFiles = [
      "apps/cms-auth/src/handler.ts",
      "apps/cms-auth/src/security.ts",
      "apps/cms-auth/test/index.test.ts",
      "apps/cms-auth/worker-configuration.d.ts",
      "apps/cms-auth/wrangler.jsonc",
    ];
    const workerSource = (
      await Promise.all(
        activeWorkerFiles.map((path) =>
          readFile(resolve(projectRoot, path), "utf8"),
        ),
      )
    ).join("\n");

    expect(workerSource).not.toContain(legacyBinding);
  });

  it("defines restrictive security headers for every CMS Admin response", async () => {
    const headersPath = resolve(cmsAdminPublic, "_headers");

    expect(existsSync(headersPath)).toBe(true);

    const headers = await readFile(headersPath, "utf8");

    expect(headers).toContain("X-Robots-Tag: noindex, nofollow");
    expect(headers).toContain("Cache-Control: no-store");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain(
      "Referrer-Policy: strict-origin-when-cross-origin",
    );
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("base-uri 'none'");
    expect(headers).toContain("object-src 'none'");
    expect(headers).not.toContain("Access-Control-Allow-Origin: *");
    expect(headers).not.toContain("unsafe-inline");
    expect(headers).not.toContain("unsafe-eval");
    expect(headers).not.toContain("Cross-Origin-Opener-Policy: same-origin");
  });

  it("serves a local SVG favicon from the CMS Admin document", async () => {
    const faviconPath = resolve(cmsAdminPublic, "favicon.svg");
    const html = await readFile(resolve(cmsAdminPublic, "index.html"), "utf8");
    const $ = load(html);

    expect($("link[rel='icon'][type='image/svg+xml']").attr("href")).toBe(
      "/favicon.svg",
    );
    expect(existsSync(faviconPath)).toBe(true);

    const favicon = await readFile(faviconPath, "utf8");
    const svg = load(favicon, { xml: true });

    expect(svg("svg[xmlns='http://www.w3.org/2000/svg']")).toHaveLength(1);
    expect(svg("svg").attr("viewBox")).toBe("0 0 64 64");
  });

  it("keeps advertising and analytics code off the CMS Admin Origin", async () => {
    const cmsSource = (await readSourceTree(["apps/cms-admin/public"]))
      .toLowerCase()
      .replaceAll(" ", "");
    const html = await readFile(resolve(cmsAdminPublic, "index.html"), "utf8");
    const $ = load(html);

    expect(cmsSource).not.toMatch(
      /googlesyndication|doubleclick|googletagmanager|google-analytics|plausible|analytics/,
    );
    expect($("script[src]")).toHaveLength(0);
  });
});
