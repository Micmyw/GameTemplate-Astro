import { describe, expect, it } from "vitest";

import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
  buildGameJsonLd,
  buildItemListJsonLd,
  buildPageTitle,
  buildWebSiteJsonLd,
  serializeJsonLd,
} from "../../src/lib/seo";

const game = {
  id: "script-game",
  data: {
    title: 'Route </script><script>alert("x")</script>',
    seoDescription: "A real description for a deliberately awkward title.",
    coverImage: { src: "/images/script-game.svg" },
    categories: [{ id: "skill-games" }],
    tags: ["timing", "<precision>"],
  },
};

const categories = [{ id: "skill-games", data: { name: "Skill Games" } }];

describe("SEO JSON-LD helpers", () => {
  it("builds a VideoGame schema only from real game and category data", () => {
    const schema = buildGameJsonLd(game, categories);

    expect(schema).toMatchObject({
      "@context": "https://schema.org",
      "@type": "VideoGame",
      name: game.data.title,
      description: game.data.seoDescription,
      image: "https://example.com/images/script-game.svg",
      url: "https://example.com/games/script-game/",
      gamePlatform: "Web browser",
      genre: ["Skill Games"],
      keywords: game.data.tags,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    });
    expect(schema).not.toHaveProperty("aggregateRating");
    expect(schema).not.toHaveProperty("review");
    expect(schema).not.toHaveProperty("publisher");
    expect(JSON.stringify(schema)).not.toContain("undefined");
  });

  it("numbers breadcrumb and item-list entries from one with absolute URLs", () => {
    expect(
      buildBreadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Games", path: "/games/" },
      ]),
    ).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://example.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Games",
          item: "https://example.com/games/",
        },
      ],
    });

    expect(
      buildItemListJsonLd([
        { name: "Going Balls", path: "/games/going-balls/" },
      ]),
    ).toMatchObject({
      "@type": "ItemList",
      numberOfItems: 1,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Going Balls",
          url: "https://example.com/games/going-balls/",
        },
      ],
    });
    expect(buildItemListJsonLd([])).toBeUndefined();
  });

  it("builds dedicated WebSite and CollectionPage schemas", () => {
    expect(buildWebSiteJsonLd()).toMatchObject({
      "@type": "WebSite",
      url: "https://example.com/",
    });
    expect(
      buildCollectionPageJsonLd({
        name: "Skill Games",
        description: "Published precision games.",
        path: "/category/skill-games/",
      }),
    ).toMatchObject({
      "@type": "CollectionPage",
      name: "Skill Games",
      description: "Published precision games.",
      url: "https://example.com/category/skill-games/",
    });
  });
});

describe("JSON-LD serialization", () => {
  it("escapes script-breaking text while preserving it after JSON.parse", () => {
    const schema = buildGameJsonLd(game, categories);
    const serialized = serializeJsonLd(schema);

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain("</script>");
    expect(JSON.parse(serialized)).toEqual(schema);
  });

  it("rejects raw HTML or JSON strings", () => {
    expect(() => serializeJsonLd('{"@type":"WebSite"}')).toThrow(
      /structured object/i,
    );
  });
});

describe("page title formatting", () => {
  it("appends the site name once and validates the final title", () => {
    expect(buildPageTitle("All browser games")).toBe(
      "All browser games | GameSite",
    );
    expect(buildPageTitle("About GameSite")).toBe("About GameSite");
    expect(() => buildPageTitle("x".repeat(66))).toThrow(/65 characters/i);
  });
});
