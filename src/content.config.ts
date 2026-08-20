import { defineCollection, reference } from "astro:content";
import { glob, type Loader } from "astro/loaders";

import {
  assertNoSelfReference,
  createCategorySchema,
  createGameSchema,
  parseAllowedGameOrigins,
} from "./lib/content-schema";

const allowedGameOrigins = parseAllowedGameOrigins(
  process.env.PUBLIC_GAME_ORIGINS ?? "https://play.example.com",
);

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
