import { getCollection, type CollectionEntry } from "astro:content";

import { getPublishedGames, type GameEntry } from "./games";

export type CategoryEntry = CollectionEntry<"categories">;

const compareCategories = (left: CategoryEntry, right: CategoryEntry): number =>
  left.data.order - right.data.order || left.id.localeCompare(right.id);

export const getPublishedCategories = async (): Promise<CategoryEntry[]> => {
  const categories = await getCollection("categories");

  return categories
    .filter((category) => category.data.status === "published")
    .sort(compareCategories);
};

export const getCategoryById = async (
  id: string,
): Promise<CategoryEntry | undefined> =>
  (await getPublishedCategories()).find((category) => category.id === id);

export const getGamesForCategory = async (
  categoryId: string,
): Promise<GameEntry[]> =>
  (await getPublishedGames()).filter((game) =>
    game.data.categories.some((category) => category.id === categoryId),
  );
