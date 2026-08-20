import { z } from "astro/zod";
import { describe, expect, it } from "vitest";

import { createGameSchema } from "../../src/lib/content-schema";
import { parseAllowedGameOrigins } from "../../src/lib/embed-url";

const imageSchema = z.string().min(1);
const referenceSchema = z.string().min(1);
const allowedOrigins = parseAllowedGameOrigins("https://play.example.com");
const siteOrigin = new URL("https://example.com");

const validGame = {
  title: "Going Balls",
  seoTitle: "Going Balls - Play a Rolling Skill Game",
  seoDescription:
    "Guide a rolling ball through elevated obstacle courses and learn the controls, route choices, and mobile support before you start playing.",
  shortDescription:
    "Guide a rolling ball across narrow tracks and carefully timed obstacles.",
  coverImage: "going-balls-cover.svg",
  coverAlt: "A blue ball crossing a suspended obstacle course",
  screenshots: [
    {
      image: "going-balls-course.svg",
      alt: "A rolling ball approaching a set of moving gates",
    },
  ],
  embedUrl: "https://play.example.com/going-balls/",
  categories: ["ball-games", "skill-games"],
  tags: ["rolling", "obstacle", "3d"],
  controls: [
    {
      input: "Arrow keys",
      action: "Steer the ball left or right",
    },
  ],
  featured: true,
  mobileSupport: "yes" as const,
  orientation: "landscape" as const,
  loadMode: "click" as const,
  aspectRatio: "16/9",
  status: "published" as const,
  publishedAt: "2026-08-18",
  updatedAt: "2026-08-19",
  source: {
    name: "Synthetic demo content",
    url: "https://example.com/",
    license: "Created for this project",
  },
  relatedGames: ["roll-ball-3d"],
};

const schemaFor = (entryId = "going-balls") =>
  createGameSchema({
    imageSchema,
    categoryReferenceSchema: referenceSchema,
    gameReferenceSchema: referenceSchema,
    allowedOrigins,
    siteOrigin,
    entryId,
  });

describe("game content schema", () => {
  it("accepts a complete game whose entry ID comes from its filename", () => {
    const parsed = schemaFor().parse(validGame);

    expect(parsed.title).toBe("Going Balls");
    expect(parsed.embedUrl).toBe("https://play.example.com/going-balls/");
    expect(typeof parsed.embedUrl).toBe("string");
    expect(parsed.publishedAt).toBeInstanceOf(Date);
    expect(parsed.updatedAt).toBeInstanceOf(Date);
  });

  it("rejects a non-HTTPS embed URL", () => {
    const result = schemaFor().safeParse({
      ...validGame,
      embedUrl: "http://play.example.com/going-balls/",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an embed URL outside PUBLIC_GAME_ORIGINS", () => {
    const result = schemaFor().safeParse({
      ...validGame,
      embedUrl: "https://games.invalid.example/going-balls/",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an embed URL on the main site origin", () => {
    const schema = createGameSchema({
      imageSchema,
      categoryReferenceSchema: referenceSchema,
      gameReferenceSchema: referenceSchema,
      allowedOrigins: parseAllowedGameOrigins("https://example.com"),
      siteOrigin,
      entryId: "going-balls",
    });

    const result = schema.safeParse({
      ...validGame,
      embedUrl: "https://example.com/games/going-balls/",
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["16/9", "16/9"],
    ["4/3", "4/3"],
    ["32/18", "16/9"],
    ["016/009", "16/9"],
  ])("normalizes aspect ratio %s to %s", (input, expected) => {
    const parsed = schemaFor().parse({ ...validGame, aspectRatio: input });

    expect(parsed.aspectRatio).toBe(expected);
    expect(typeof parsed.aspectRatio).toBe("string");
  });

  it.each([
    "0/0",
    "16/0",
    "0/9",
    "-16/9",
    "16/-9",
    "16.5/9",
    "16/9.5",
    "16 x 9",
    "wide",
    "16/",
    "/9",
  ])("rejects invalid aspect ratio %s", (aspectRatio) => {
    const result = schemaFor().safeParse({ ...validGame, aspectRatio });

    expect(result.success).toBe(false);
  });

  it("rejects an empty categories list", () => {
    const result = schemaFor().safeParse({ ...validGame, categories: [] });

    expect(result.success).toBe(false);
  });

  it("rejects updatedAt earlier than publishedAt", () => {
    const result = schemaFor().safeParse({
      ...validGame,
      publishedAt: "2026-08-19",
      updatedAt: "2026-08-18",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a relatedGames self-reference", () => {
    const result = schemaFor("going-balls").safeParse({
      ...validGame,
      relatedGames: ["going-balls"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an SEO title longer than 65 characters", () => {
    const result = schemaFor().safeParse({
      ...validGame,
      seoTitle: "A".repeat(66),
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty cover image alt", () => {
    const result = schemaFor().safeParse({ ...validGame, coverAlt: "   " });

    expect(result.success).toBe(false);
  });
});
