import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { load } from "cheerio";
import { Window } from "happy-dom";
import { parse } from "yaml";
import { z } from "astro/zod";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createCategorySchema,
  createGameSchema,
} from "../../src/lib/content-schema";
import { parseAllowedGameOrigins } from "../../src/lib/embed-url";

type UnknownRecord = Record<string, unknown>;

const projectRoot = resolve(import.meta.dirname, "../..");
const configPath = resolve(projectRoot, "public/admin/config.yml");
const adminPath = resolve(projectRoot, "public/admin/index.html");

const asRecord = (value: unknown, label: string): UnknownRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
};

const asArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
};

const fieldsFor = (container: UnknownRecord, label: string): UnknownRecord[] =>
  asArray(container.fields, `${label}.fields`).map((value, index) =>
    asRecord(value, `${label}.fields[${index}]`),
  );

const fieldMap = (container: UnknownRecord, label: string) =>
  new Map(
    fieldsFor(container, label).map((field) => [String(field.name), field]),
  );

const collectionMap = (config: UnknownRecord) =>
  new Map(
    asArray(config.collections, "collections").map((value, index) => {
      const collection = asRecord(value, `collections[${index}]`);
      return [String(collection.name), collection];
    }),
  );

const enumOptions = (schema: unknown): string[] => {
  const options = asRecord(schema, "enum schema").options;
  if (
    !Array.isArray(options) ||
    !options.every((value) => typeof value === "string")
  ) {
    throw new Error("Expected a Zod enum with string options");
  }
  return options;
};

const gameSchema = createGameSchema({
  imageSchema: z.string().min(1),
  categoryReferenceSchema: z.string().min(1),
  gameReferenceSchema: z.string().min(1),
  allowedOrigins: parseAllowedGameOrigins("https://play.example.com"),
  siteOrigin: new URL("https://example.com"),
});
const categorySchema = createCategorySchema();

let config: UnknownRecord;
let adminHtml: string;
const windows: Window[] = [];

beforeAll(async () => {
  config = asRecord(parse(await readFile(configPath, "utf8")), "config");
  adminHtml = await readFile(adminPath, "utf8");
});

afterEach(async () => {
  await Promise.all(
    windows.splice(0).map(async (window) => {
      await window.happyDOM.abort();
      window.close();
    }),
  );
});

describe("Decap CMS configuration", () => {
  it("targets the real GitHub repository while keeping production OAuth absent in PR 5A", () => {
    const backend = asRecord(config.backend, "backend");

    expect(backend).toMatchObject({
      name: "github",
      repo: "Micmyw/GameTemplate-Astro",
      branch: "main",
      auth_scope: "public_repo",
    });
    expect(backend).not.toHaveProperty("base_url");
    expect(backend).not.toHaveProperty("auth_endpoint");

    const serialized = JSON.stringify(config).toLowerCase();
    expect(serialized).not.toContain("decapbridge");
    expect(serialized).not.toContain("owner/repo");
  });

  it("binds the local backend only to the approved loopback hosts", () => {
    expect(asRecord(config.local_backend, "local_backend")).toEqual({
      url: "http://127.0.0.1:8081/api/v1",
      allowed_hosts: ["127.0.0.1", "localhost"],
    });
  });

  it("maps the games collection exactly to the live Astro schema", () => {
    const games = collectionMap(config).get("games");
    if (!games) throw new Error("Missing games collection");

    expect(games).toMatchObject({
      folder: "src/content/games",
      create: true,
      extension: "md",
      format: "frontmatter",
      media_folder: "src/assets/images/games",
      public_folder: "../../assets/images/games",
    });

    const configuredFields = fieldMap(games, "games");
    expect([...configuredFields.keys()].sort()).toEqual(
      [...Object.keys(gameSchema.shape), "body"].sort(),
    );
    for (const field of configuredFields.values()) {
      expect(field.required, `${String(field.name)} required`).toBe(true);
    }

    expect(
      asArray(configuredFields.get("status")?.options, "status.options"),
    ).toEqual(enumOptions(gameSchema.shape.status));
    expect(
      asArray(
        configuredFields.get("mobileSupport")?.options,
        "mobileSupport.options",
      ),
    ).toEqual(enumOptions(gameSchema.shape.mobileSupport));
    expect(
      asArray(
        configuredFields.get("orientation")?.options,
        "orientation.options",
      ),
    ).toEqual(enumOptions(gameSchema.shape.orientation));
    expect(
      asArray(configuredFields.get("loadMode")?.options, "loadMode.options"),
    ).toEqual(enumOptions(gameSchema.shape.loadMode));
  });

  it("uses object lists for paired screenshots and controls", () => {
    const games = collectionMap(config).get("games");
    if (!games) throw new Error("Missing games collection");
    const fields = fieldMap(games, "games");

    const screenshots = asRecord(fields.get("screenshots"), "screenshots");
    expect(screenshots.widget).toBe("list");
    expect([...fieldMap(screenshots, "screenshots").keys()]).toEqual([
      "image",
      "alt",
    ]);

    const controls = asRecord(fields.get("controls"), "controls");
    expect(controls.widget).toBe("list");
    expect([...fieldMap(controls, "controls").keys()]).toEqual([
      "input",
      "action",
    ]);

    const source = asRecord(fields.get("source"), "source");
    expect(source.widget).toBe("object");
    expect([...fieldMap(source, "source").keys()]).toEqual([
      "name",
      "url",
      "license",
    ]);
  });

  it("configures exact relation targets and slug values", () => {
    const games = collectionMap(config).get("games");
    if (!games) throw new Error("Missing games collection");
    const fields = fieldMap(games, "games");

    expect(fields.get("categories")).toMatchObject({
      widget: "relation",
      collection: "categories",
      value_field: "{{slug}}",
      multiple: true,
    });
    expect(fields.get("relatedGames")).toMatchObject({
      widget: "relation",
      collection: "games",
      value_field: "{{slug}}",
      multiple: true,
    });
  });

  it("stores ISO dates without localized time strings", () => {
    const games = collectionMap(config).get("games");
    if (!games) throw new Error("Missing games collection");
    const fields = fieldMap(games, "games");

    for (const name of ["publishedAt", "updatedAt"]) {
      expect(fields.get(name)).toMatchObject({
        widget: "datetime",
        format: "YYYY-MM-DD",
        date_format: "YYYY-MM-DD",
        time_format: false,
      });
    }
  });

  it("uses CMS patterns that reject unsafe game URLs and invalid aspect ratios", () => {
    const games = collectionMap(config).get("games");
    if (!games) throw new Error("Missing games collection");
    const fields = fieldMap(games, "games");
    const embedPattern = asArray(
      fields.get("embedUrl")?.pattern,
      "embedUrl.pattern",
    );
    const ratioPattern = asArray(
      fields.get("aspectRatio")?.pattern,
      "aspectRatio.pattern",
    );
    const embedRegex = new RegExp(String(embedPattern[0]));
    const ratioRegex = new RegExp(String(ratioPattern[0]));

    expect(embedRegex.test("https://play.example.com/game/index.html")).toBe(
      true,
    );
    expect(
      embedRegex.test("https://play.example.com/game/index.html?v=2"),
    ).toBe(true);
    expect(embedRegex.test("http://play.example.com/game/index.html")).toBe(
      false,
    );
    expect(embedRegex.test("https://play.example.com/game/Index.html")).toBe(
      false,
    );
    expect(
      embedRegex.test("https://play.example.com/game/index.html#fragment"),
    ).toBe(false);
    expect(ratioRegex.test("16/9")).toBe(true);
    expect(ratioRegex.test("0/9")).toBe(false);
    expect(ratioRegex.test("16/0")).toBe(false);
  });

  it("maps categories exactly to the live Astro schema", () => {
    const categories = collectionMap(config).get("categories");
    if (!categories) throw new Error("Missing categories collection");

    expect(categories).toMatchObject({
      folder: "src/content/categories",
      create: true,
      extension: "md",
      format: "frontmatter",
    });
    const configuredFields = fieldMap(categories, "categories");
    expect([...configuredFields.keys()].sort()).toEqual(
      [...Object.keys(categorySchema.shape), "body"].sort(),
    );
    for (const field of configuredFields.values()) {
      expect(field.required, `${String(field.name)} required`).toBe(true);
    }
    expect(configuredFields.get("status")?.options).toEqual(
      enumOptions(categorySchema.shape.status),
    );
    expect(configuredFields.get("order")).toMatchObject({
      widget: "number",
      value_type: "int",
      min: 0,
    });
  });

  it("serves a noindex Admin shell with a pinned, integrity-protected client", () => {
    const $ = load(adminHtml);
    const robots = $('meta[name="robots"]').attr("content");

    expect(robots).toBe("noindex, nofollow");
    expect($("title").text().trim()).toBe("Game Content Administration");
    expect($("html").attr("lang")).toBe("en");
    expect($("meta[charset]").attr("charset")?.toLowerCase()).toBe("utf-8");
    expect($('meta[name="viewport"]').attr("content")).toBeTruthy();
  });

  it.each([
    ["http://localhost:4321/admin/", true],
    ["http://127.0.0.1:4321/admin/", true],
    ["http://[::1]:4321/admin/", true],
    ["https://preview.example.test/admin/", false],
  ])(
    "loads the CMS client only for approved local hostname %s",
    async (url, shouldLoad) => {
      const window = new Window({ url });
      windows.push(window);
      const document = window.document as unknown as Document;
      const parsedDocument = new window.DOMParser().parseFromString(
        adminHtml,
        "text/html",
      );
      document.documentElement.lang = parsedDocument.documentElement.lang;
      document.head.innerHTML = parsedDocument.head.innerHTML;
      document.body.innerHTML = parsedDocument.body.innerHTML;
      for (const attribute of parsedDocument.body.attributes) {
        document.body.setAttribute(attribute.name, attribute.value ?? "");
      }
      const inlineScript = [...document.querySelectorAll("script")].find(
        (script) => !script.getAttribute("src"),
      );
      if (!inlineScript?.textContent)
        throw new Error("Missing Admin guard script");

      window.eval(inlineScript.textContent);

      const client = document.querySelector("script[data-decap-client]");
      expect(Boolean(client)).toBe(shouldLoad);
      if (shouldLoad) {
        expect(client?.getAttribute("src")).toContain("decap-cms@3.15.1/");
        expect(client?.getAttribute("src")).not.toContain("latest");
        expect(client?.getAttribute("integrity")).toMatch(/^sha384-/);
        expect(client?.getAttribute("crossorigin")).toBe("anonymous");
      } else {
        expect(document.body.textContent).toContain(
          "CMS authentication is not configured for this deployment.",
        );
      }
    },
  );
});
