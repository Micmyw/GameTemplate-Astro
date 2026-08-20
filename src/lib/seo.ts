import { SITE } from "../config/site";
import { absoluteUrl } from "./urls";

export const MAX_PAGE_TITLE_LENGTH = 65;

type ImageSource = string | { src: string };

export type GameSeoEntry = {
  id: string;
  data: {
    title: string;
    seoDescription: string;
    coverImage: ImageSource;
    categories: readonly { id: string }[];
    tags: readonly string[];
  };
};

export type CategorySeoEntry = {
  id: string;
  data: { name: string };
};

export type SeoListItem = {
  name: string;
  path: string;
};

const imagePath = (image: ImageSource): string =>
  typeof image === "string" ? image : image.src;

export const buildPageTitle = (title: string): string => {
  const candidate = title.trim();

  if (!candidate) {
    throw new Error("Page title must not be empty");
  }

  const finalTitle = candidate
    .toLocaleLowerCase()
    .includes(SITE.name.toLocaleLowerCase())
    ? candidate
    : `${candidate} | ${SITE.name}`;

  if (finalTitle.length > MAX_PAGE_TITLE_LENGTH) {
    throw new Error(
      `Final page title must not exceed ${MAX_PAGE_TITLE_LENGTH} characters: ${finalTitle}`,
    );
  }

  return finalTitle;
};

export const buildGameJsonLd = (
  entry: GameSeoEntry,
  categories: readonly CategorySeoEntry[],
) => {
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.data.name]),
  );

  return {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: entry.data.title,
    description: entry.data.seoDescription,
    image: absoluteUrl(imagePath(entry.data.coverImage)),
    url: absoluteUrl(`/games/${entry.id}/`),
    gamePlatform: "Web browser",
    genre: entry.data.categories.flatMap((category) => {
      const name = categoryNames.get(category.id);
      return name ? [name] : [];
    }),
    keywords: [...entry.data.tags],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
};

export const buildBreadcrumbJsonLd = (items: readonly SeoListItem[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path),
  })),
});

export const buildItemListJsonLd = (items: readonly SeoListItem[]) => {
  if (items.length === 0) return undefined;

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  };
};

export const buildWebSiteJsonLd = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE.name,
  description: SITE.description,
  url: absoluteUrl("/"),
});

export const buildCollectionPageJsonLd = ({
  name,
  description,
  path,
}: SeoListItem & { description: string }) => ({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name,
  description,
  url: absoluteUrl(path),
});

export const serializeJsonLd = (data: unknown): string => {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("JSON-LD data must be a structured object");
  }

  return JSON.stringify(data).replace(/</g, "\\u003c");
};
