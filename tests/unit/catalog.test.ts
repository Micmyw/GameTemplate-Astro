import type { CollectionEntry } from "astro:content";
import { describe, expect, it, vi } from "vitest";

vi.mock("astro:content", () => ({ getCollection: vi.fn() }));

import { validateCatalog } from "../../src/lib/content/catalog";

type GameEntry = CollectionEntry<"games">;
type CategoryEntry = CollectionEntry<"categories">;

const image = {
  src: "/_astro/test-cover.svg",
  width: 640,
  height: 480,
  format: "svg" as const,
};

const category = (
  id: string,
  name: string,
  status: "draft" | "published" = "published",
): CategoryEntry =>
  ({
    id,
    collection: "categories",
    body: `Category body for ${id}`,
    filePath: `src/content/categories/${id}.md`,
    data: {
      name,
      seoTitle: `${name.trim()} category title online`,
      seoDescription:
        "A complete category description that is deliberately long enough for schema validation and catalog testing.",
      shortDescription: `A complete short category description for ${id}.`,
      order: 1,
      featured: true,
      status,
    },
  }) as CategoryEntry;

const game = (
  id: string,
  categoryIds: string[],
  status: "draft" | "published" = "published",
): GameEntry =>
  ({
    id,
    collection: "games",
    body: `Unique body for ${id}`,
    filePath: `src/content/games/${id}.md`,
    data: {
      title: id,
      seoTitle: `${id} title with enough characters`,
      seoDescription:
        "A complete fixture description that is deliberately long enough for the production content schema requirements.",
      shortDescription: `A complete short description for ${id}.`,
      coverImage: image,
      coverAlt: `Cover art for ${id}`,
      screenshots: [{ image, alt: `Course view for ${id}` }],
      embedUrl: `https://play.example.com/${id}/index.html`,
      categories: categoryIds.map((categoryId) => ({
        id: categoryId,
        collection: "categories" as const,
      })),
      tags: ["rolling"],
      controls: [{ input: "Arrow keys", action: "Steer" }],
      featured: false,
      mobileSupport: "yes",
      orientation: "landscape",
      loadMode: "click",
      aspectRatio: "16/9",
      status,
      publishedAt: new Date("2026-08-18"),
      updatedAt: new Date("2026-08-18"),
      source: {
        name: "Fixture author",
        url: "https://example.com/",
        license: "Fixture license",
      },
      relatedGames: [],
    },
  }) as GameEntry;

describe("catalog validation", () => {
  it("rejects a published game that references a draft category", () => {
    const categories = [category("draft-lane", "Draft Lane", "draft")];

    expect(() =>
      validateCatalog([game("published-game", ["draft-lane"])], categories),
    ).toThrow(/published-game.*draft-lane.*draft/i);
  });

  it("rejects a draft game that references a draft category", () => {
    const categories = [category("draft-lane", "Draft Lane", "draft")];

    expect(() =>
      validateCatalog(
        [game("draft-game", ["draft-lane"], "draft")],
        categories,
      ),
    ).toThrow(/draft-game.*draft-lane.*draft/i);
  });

  it("rejects a game that references a missing category", () => {
    expect(() =>
      validateCatalog([game("lost-game", ["missing-lane"])], []),
    ).toThrow(/lost-game.*missing-lane.*not exist/i);
  });

  it("rejects normalized duplicate category names and identifies both IDs", () => {
    const categories = [
      category("ball-games", "Ball Games"),
      category("rolling-balls", " ball games "),
    ];

    expect(() => validateCatalog([], categories)).toThrow(
      /ball-games.*rolling-balls|rolling-balls.*ball-games/i,
    );
  });

  it("accepts a catalog whose games reference distinct published categories", () => {
    const categories = [
      category("ball-games", "Ball Games"),
      category("skill-games", "Skill Games"),
    ];
    const games = [
      game("going-balls", ["ball-games", "skill-games"]),
      game("roll-ball-3d", ["ball-games"]),
    ];

    expect(validateCatalog(games, categories)).toEqual({ games, categories });
  });
});
