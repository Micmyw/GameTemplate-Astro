export const DEFAULT_SITE_ORIGIN = "https://example.com";

export const normalizeSiteOrigin = (rawValue: string): URL => {
  const value = rawValue.trim();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `PUBLIC_SITE_URL must be an absolute HTTPS origin: ${rawValue}`,
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(`PUBLIC_SITE_URL must use HTTPS: ${rawValue}`);
  }

  if (url.username || url.password) {
    throw new Error(
      `PUBLIC_SITE_URL must not contain credentials: ${rawValue}`,
    );
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `PUBLIC_SITE_URL must be an origin without a path, query, or hash: ${rawValue}`,
    );
  }

  return new URL(url.origin);
};

export const resolveSiteOrigin = (rawValue?: string): URL =>
  normalizeSiteOrigin(rawValue ?? DEFAULT_SITE_ORIGIN);
