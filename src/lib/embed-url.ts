export const DEFAULT_GAME_ORIGIN = "https://play.example.com";

const configurationError = (message: string, value?: string): Error =>
  new Error(
    `PUBLIC_GAME_ORIGINS ${message}${value === undefined ? "" : `: ${value}`}`,
  );

export function parseAllowedGameOrigins(raw: string): readonly URL[] {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw configurationError("must contain at least one HTTPS origin");
  }

  const origins = new Map<string, URL>();

  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw configurationError("entries must be absolute URLs", value);
    }

    if (url.protocol !== "https:") {
      throw configurationError("entries must use HTTPS", value);
    }

    if (url.username || url.password) {
      throw configurationError("entries cannot contain credentials", value);
    }

    if (
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      value.includes("?") ||
      value.includes("#")
    ) {
      throw configurationError(
        "entries must be origins without a path, query, or fragment",
        value,
      );
    }

    if (!origins.has(url.origin)) {
      origins.set(url.origin, new URL(url.origin));
    }
  }

  return [...origins.values()];
}

export function validateEmbedUrl(
  raw: string,
  allowedOrigins: readonly URL[],
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`embedUrl must be an absolute HTTPS URL: ${raw}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`embedUrl must use HTTPS: ${raw}`);
  }

  if (url.username || url.password) {
    throw new Error(`embedUrl cannot contain credentials: ${raw}`);
  }

  if (url.hash || raw.includes("#")) {
    throw new Error(`embedUrl cannot contain a fragment: ${raw}`);
  }

  if (!url.pathname.endsWith("/")) {
    throw new Error(`embedUrl path must end with a trailing slash: ${raw}`);
  }

  if (!allowedOrigins.some((allowed) => allowed.origin === url.origin)) {
    throw new Error(`embedUrl origin is not allowed: ${url.origin}`);
  }

  return url;
}

export function assertCrossOrigin(gameUrl: URL, siteOrigin: URL): URL {
  if (gameUrl.origin === siteOrigin.origin) {
    throw new Error(
      `The game and main site must use different origins: ${gameUrl.origin}`,
    );
  }

  return gameUrl;
}
