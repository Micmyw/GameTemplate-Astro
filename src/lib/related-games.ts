import type { CollectionEntry } from "astro:content";

type GameEntry = CollectionEntry<"games">;

const MAX_RELATED_GAMES = 8;

const referenceIds = (
  references: readonly { id: string; collection: string }[],
): string[] => references.map(({ id }) => id);

const sharedCount = (left: readonly string[], right: readonly string[]) => {
  const rightValues = new Set(right);
  return new Set(left.filter((value) => rightValues.has(value))).size;
};

export const rankRelatedGames = (
  game: GameEntry,
  candidates: readonly GameEntry[],
  limit = MAX_RELATED_GAMES,
): GameEntry[] => {
  const explicitOrder = new Map(
    referenceIds(game.data.relatedGames).map((id, index) => [id, index]),
  );
  const gameCategories = referenceIds(game.data.categories);
  const resultLimit = Math.min(
    MAX_RELATED_GAMES,
    Math.max(0, Math.floor(limit)),
  );

  return candidates
    .filter(
      (candidate) =>
        candidate.id !== game.id && candidate.data.status === "published",
    )
    .sort((left, right) => {
      const leftExplicit = explicitOrder.get(left.id);
      const rightExplicit = explicitOrder.get(right.id);

      if (leftExplicit !== undefined || rightExplicit !== undefined) {
        if (leftExplicit === undefined) return 1;
        if (rightExplicit === undefined) return -1;
        return leftExplicit - rightExplicit;
      }

      const categoryDifference =
        sharedCount(gameCategories, referenceIds(right.data.categories)) -
        sharedCount(gameCategories, referenceIds(left.data.categories));
      if (categoryDifference) return categoryDifference;

      const tagDifference =
        sharedCount(game.data.tags, right.data.tags) -
        sharedCount(game.data.tags, left.data.tags);
      if (tagDifference) return tagDifference;

      const dateDifference =
        right.data.publishedAt.getTime() - left.data.publishedAt.getTime();
      if (dateDifference) return dateDifference;

      return left.id.localeCompare(right.id);
    })
    .slice(0, resultLimit);
};
