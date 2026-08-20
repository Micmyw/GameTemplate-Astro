import type { CollectionEntry } from "astro:content";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCollectionMock = vi.hoisted(() => vi.fn());

vi.mock("astro:content", () => ({
  getCollection: getCollectionMock,
}));

import {
  getFeaturedGames,
  getGameById,
  getPublishedGames,
} from "../../src/lib/content/games";
import {
  getCategoryById,
  getGamesForCategory,
  getPopulatedPublishedCategories,
  getPublishedCategories,
} from "../../src/lib/content/categories";

type GameEntry = CollectionEntry<"games">;
type CategoryEntry = CollectionEntry<"categories">;

const image = {
  src: "/_astro/test-cover.svg",
  width: 640,
  height: 480,
  format: "svg" as const,
};

const game = (
  id: string,
  options: {
    status?: "draft" | "published";
    featured?: boolean;
    publishedAt?: string;
    categories?: string[];
  } = {},
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
      embedUrl: `https://play.example.com/${id}/`,
      categories: (options.categories ?? ["ball-games"]).map((categoryId) => ({
        id: categoryId,
        collection: "categories" as const,
      })),
      tags: ["rolling"],
      controls: [{ input: "Arrow keys", action: "Steer" }],
      featured: options.featured ?? false,
      mobileSupport: "yes",
      orientation: "landscape",
      loadMode: "click",
      aspectRatio: "16/9",
      status: options.status ?? "published",
      publishedAt: new Date(options.publishedAt ?? "2026-08-18"),
      updatedAt: new Date(options.publishedAt ?? "2026-08-18"),
      source: {
        name: "Fixture author",
        url: "https://example.com/",
        license: "Fixture license",
      },
      relatedGames: [],
    },
  }) as GameEntry;

const category = (
  id: string,
  order: number,
  status: "draft" | "published" = "published",
): CategoryEntry =>
  ({
    id,
    collection: "categories",
    body: `Category body for ${id}`,
    filePath: `src/content/categories/${id}.md`,
    data: {
      name: id,
      seoTitle: `${id} category title online`,
      seoDescription:
        "A complete category description that is deliberately long enough for schema validation and query testing.",
      shortDescription: `A complete short category description for ${id}.`,
      order,
      featured: true,
      status,
    },
  }) as CategoryEntry;

const games = [
  game("zeta", { publishedAt: "2026-08-19", featured: true }),
  game("alpha", { publishedAt: "2026-08-19", featured: true }),
  game("older", {
    publishedAt: "2026-08-17",
    categories: ["skill-games"],
  }),
  game("draft-game", {
    status: "draft",
    featured: true,
    publishedAt: "2026-08-20",
  }),
];

const categories = [
  category("ball-games", 5),
  category("zeta-category", 10),
  category("alpha-category", 10),
  category("skill-games", 15),
  category("later-category", 20),
  category("draft-category", 1, "draft"),
];

beforeEach(() => {
  getCollectionMock.mockReset();
  getCollectionMock.mockImplementation(async (collectionName: string) => {
    if (collectionName === "games") return games;
    if (collectionName === "categories") return categories;
    return [];
  });
});

describe("game content queries", () => {
  it("excludes drafts and sorts by publishedAt DESC then ID ASC", async () => {
    const result = await getPublishedGames();

    expect(result.map(({ id }) => id)).toEqual(["alpha", "zeta", "older"]);
  });

  it("applies the featured game limit after deterministic sorting", async () => {
    const result = await getFeaturedGames(1);

    expect(result.map(({ id }) => id)).toEqual(["alpha"]);
  });

  it("returns undefined for a missing or draft game ID", async () => {
    await expect(getGameById("missing")).resolves.toBeUndefined();
    await expect(getGameById("draft-game")).resolves.toBeUndefined();
  });
});

describe("category content queries", () => {
  it("excludes drafts and sorts by order ASC then ID ASC", async () => {
    const result = await getPublishedCategories();

    expect(result.map(({ id }) => id)).toEqual([
      "ball-games",
      "alpha-category",
      "zeta-category",
      "skill-games",
      "later-category",
    ]);
  });

  it("returns only published categories populated by published games", async () => {
    const result = await getPopulatedPublishedCategories();

    expect(
      result.map(({ category: entry, games: categoryGames }) => ({
        id: entry.id,
        games: categoryGames.map(({ id }) => id),
      })),
    ).toEqual([
      { id: "ball-games", games: ["alpha", "zeta"] },
      { id: "skill-games", games: ["older"] },
    ]);
  });

  it("returns undefined for a missing or draft category ID", async () => {
    await expect(getCategoryById("missing")).resolves.toBeUndefined();
    await expect(getCategoryById("draft-category")).resolves.toBeUndefined();
  });

  it("returns only published games assigned to the requested category", async () => {
    const result = await getGamesForCategory("ball-games");

    expect(result.map(({ id }) => id)).toEqual(["alpha", "zeta"]);
  });
});
