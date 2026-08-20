import { getCollection, type CollectionEntry } from "astro:content";

export type GameEntry = CollectionEntry<"games">;
export type CategoryEntry = CollectionEntry<"categories">;

export type ValidatedCatalog = {
  games: GameEntry[];
  categories: CategoryEntry[];
};

const normalizeCategoryName = (name: string): string =>
  name.trim().toLowerCase();

export const validateCatalog = (
  games: readonly GameEntry[],
  categories: readonly CategoryEntry[],
): ValidatedCatalog => {
  const categoriesById = new Map(
    categories.map((category) => [category.id, category]),
  );
  const categoryIdsByName = new Map<string, string>();

  for (const category of categories) {
    const normalizedName = normalizeCategoryName(category.data.name);
    const duplicateId = categoryIdsByName.get(normalizedName);

    if (duplicateId) {
      throw new Error(
        `Duplicate category name "${normalizedName}" for category IDs "${duplicateId}" and "${category.id}"`,
      );
    }

    categoryIdsByName.set(normalizedName, category.id);
  }

  for (const game of games) {
    for (const reference of game.data.categories) {
      const category = categoriesById.get(reference.id);

      if (!category) {
        throw new Error(
          `Game "${game.id}" references category "${reference.id}", which does not exist`,
        );
      }

      if (category.data.status !== "published") {
        throw new Error(
          `Game "${game.id}" references category "${category.id}" with status "${category.data.status}"; referenced categories must be published`,
        );
      }
    }
  }

  return { games: [...games], categories: [...categories] };
};

export const getValidatedCatalog = async (): Promise<ValidatedCatalog> => {
  const [games, categories] = await Promise.all([
    getCollection("games"),
    getCollection("categories"),
  ]);

  return validateCatalog(games, categories);
};
