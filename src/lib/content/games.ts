import { getValidatedCatalog, type GameEntry } from "./catalog";

export type { GameEntry } from "./catalog";

export const compareGames = (left: GameEntry, right: GameEntry): number => {
  const dateDifference =
    right.data.publishedAt.getTime() - left.data.publishedAt.getTime();

  return dateDifference || left.id.localeCompare(right.id);
};

export const selectPublishedGames = (
  games: readonly GameEntry[],
): GameEntry[] =>
  games.filter((game) => game.data.status === "published").sort(compareGames);

export const getPublishedGames = async (): Promise<GameEntry[]> => {
  const { games } = await getValidatedCatalog();

  return selectPublishedGames(games);
};

export const getFeaturedGames = async (
  limit?: number,
): Promise<GameEntry[]> => {
  const featuredGames = (await getPublishedGames()).filter(
    (game) => game.data.featured,
  );

  if (limit === undefined) {
    return featuredGames;
  }

  return featuredGames.slice(0, Math.max(0, Math.floor(limit)));
};

export const getGameById = async (id: string): Promise<GameEntry | undefined> =>
  (await getPublishedGames()).find((game) => game.id === id);
