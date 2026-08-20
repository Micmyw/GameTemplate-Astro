import type { CollectionEntry } from "astro:content";
import { describe, expect, it } from "vitest";

import { rankRelatedGames } from "../../src/lib/related-games";

type GameEntry = CollectionEntry<"games">;

const game = (
  id: string,
  options: {
    status?: "draft" | "published";
    publishedAt?: string;
    categories?: string[];
    tags?: string[];
    relatedGames?: string[];
  } = {},
): GameEntry =>
  ({
    id,
    collection: "games",
    body: `Body for ${id}`,
    filePath: `src/content/games/${id}.md`,
    data: {
      title: id,
      seoTitle: `${id} title with enough characters`,
      seoDescription:
        "A complete fixture description that is deliberately long enough for the production content schema requirements.",
      shortDescription: `A complete short description for ${id}.`,
      coverImage: {
        src: "/_astro/test-cover.svg",
        width: 640,
        height: 480,
        format: "svg",
      },
      coverAlt: `Cover art for ${id}`,
      screenshots: [],
      embedUrl: `https://play.example.com/${id}/`,
      categories: (options.categories ?? []).map((categoryId) => ({
        id: categoryId,
        collection: "categories" as const,
      })),
      tags: options.tags ?? [],
      controls: [{ input: "Arrow keys", action: "Steer" }],
      featured: false,
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
      relatedGames: (options.relatedGames ?? []).map((gameId) => ({
        id: gameId,
        collection: "games" as const,
      })),
    },
  }) as GameEntry;

describe("rankRelatedGames", () => {
  it("places explicit related games first in their declared order", () => {
    const current = game("current", {
      relatedGames: ["explicit-b", "explicit-a"],
      categories: ["ball-games"],
    });
    const candidates = [
      game("shared", { categories: ["ball-games"] }),
      game("explicit-a"),
      game("explicit-b"),
    ];

    expect(rankRelatedGames(current, candidates).map(({ id }) => id)).toEqual([
      "explicit-b",
      "explicit-a",
      "shared",
    ]);
  });

  it("ranks by shared categories, shared tags, newest date, then ID ASC", () => {
    const current = game("current", {
      categories: ["ball-games", "skill-games"],
      tags: ["rolling", "timing"],
    });
    const candidates = [
      game("one-category", {
        categories: ["ball-games"],
        tags: ["rolling", "timing"],
        publishedAt: "2026-08-20",
      }),
      game("two-categories", {
        categories: ["ball-games", "skill-games"],
        publishedAt: "2026-08-16",
      }),
      game("one-tag", {
        categories: ["ball-games"],
        tags: ["rolling"],
        publishedAt: "2026-08-20",
      }),
      game("two-tags-new", {
        categories: ["ball-games"],
        tags: ["rolling", "timing"],
        publishedAt: "2026-08-19",
      }),
      game("two-tags-old-b", {
        categories: ["ball-games"],
        tags: ["rolling", "timing"],
        publishedAt: "2026-08-18",
      }),
      game("two-tags-old-a", {
        categories: ["ball-games"],
        tags: ["rolling", "timing"],
        publishedAt: "2026-08-18",
      }),
    ];

    expect(rankRelatedGames(current, candidates).map(({ id }) => id)).toEqual([
      "two-categories",
      "one-category",
      "two-tags-new",
      "two-tags-old-a",
      "two-tags-old-b",
      "one-tag",
    ]);
  });

  it("excludes the current game and all draft candidates", () => {
    const current = game("current");
    const candidates = [
      current,
      game("draft", { status: "draft" }),
      game("published"),
    ];

    expect(rankRelatedGames(current, candidates).map(({ id }) => id)).toEqual([
      "published",
    ]);
  });

  it("respects a requested limit and never returns more than eight games", () => {
    const current = game("current");
    const candidates = Array.from({ length: 12 }, (_, index) =>
      game(`candidate-${String(index).padStart(2, "0")}`),
    );

    expect(rankRelatedGames(current, candidates, 3)).toHaveLength(3);
    expect(rankRelatedGames(current, candidates, 20)).toHaveLength(8);
  });
});
