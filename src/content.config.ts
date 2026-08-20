import { defineCollection, reference } from "astro:content";
import { glob, type Loader } from "astro/loaders";

import {
  assertNoSelfReference,
  createCategorySchema,
  createGameSchema,
} from "./lib/content-schema";
import {
  assertCrossOrigin,
  DEFAULT_GAME_ORIGIN,
  parseAllowedGameOrigins,
} from "./lib/embed-url";
import { resolveSiteOrigin } from "./lib/site-origin";

const allowedGameOrigins = parseAllowedGameOrigins(
  import.meta.env.PUBLIC_GAME_ORIGINS ?? DEFAULT_GAME_ORIGIN,
);
const siteOrigin = resolveSiteOrigin(import.meta.env.PUBLIC_SITE_URL);

for (const gameOrigin of allowedGameOrigins) {
  assertCrossOrigin(gameOrigin, siteOrigin);
}

const createValidatedGameLoader = (): Loader => {
  const loader = glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/games",
  });

  return {
    ...loader,
    name: "validated-game-glob-loader",
    async load(context) {
      await loader.load(context);

      for (const entry of context.store.values()) {
        const data = entry.data as { relatedGames?: unknown[] };
        assertNoSelfReference(entry.id, data.relatedGames ?? []);
      }
    },
  };
};

const games = defineCollection({
  loader: createValidatedGameLoader(),
  schema: ({ image }) =>
    createGameSchema({
      imageSchema: image(),
      categoryReferenceSchema: reference("categories"),
      gameReferenceSchema: reference("games"),
      allowedOrigins: allowedGameOrigins,
      siteOrigin,
    }),
});

const categories = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/categories",
  }),
  schema: createCategorySchema(),
});

export const collections = {
  games,
  categories,
};
