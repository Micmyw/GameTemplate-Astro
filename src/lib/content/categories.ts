import {
  getValidatedCatalog,
  type CategoryEntry,
  type GameEntry,
} from "./catalog";
import { selectPublishedGames } from "./games";

export type { CategoryEntry } from "./catalog";

export type PopulatedCategory = {
  category: CategoryEntry;
  games: GameEntry[];
};

const compareCategories = (left: CategoryEntry, right: CategoryEntry): number =>
  left.data.order - right.data.order || left.id.localeCompare(right.id);

const selectPublishedCategories = (
  categories: readonly CategoryEntry[],
): CategoryEntry[] =>
  categories
    .filter((category) => category.data.status === "published")
    .sort(compareCategories);

export const getPublishedCategories = async (): Promise<CategoryEntry[]> => {
  const { categories } = await getValidatedCatalog();

  return selectPublishedCategories(categories);
};

export const getCategoryById = async (
  id: string,
): Promise<CategoryEntry | undefined> =>
  (await getPublishedCategories()).find((category) => category.id === id);

export const getGamesForCategory = async (
  categoryId: string,
): Promise<GameEntry[]> => {
  const { games } = await getValidatedCatalog();

  return selectPublishedGames(games).filter((game) =>
    game.data.categories.some((category) => category.id === categoryId),
  );
};

export const getPopulatedPublishedCategories = async (): Promise<
  PopulatedCategory[]
> => {
  const { games, categories } = await getValidatedCatalog();
  const publishedGames = selectPublishedGames(games);

  return selectPublishedCategories(categories).flatMap((category) => {
    const categoryGames = publishedGames.filter((game) =>
      game.data.categories.some((reference) => reference.id === category.id),
    );

    return categoryGames.length > 0 ? [{ category, games: categoryGames }] : [];
  });
};
