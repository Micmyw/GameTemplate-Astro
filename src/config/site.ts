const configuredUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://example.com";

export const SITE = {
  name: import.meta.env.PUBLIC_SITE_NAME ?? "GameSite",
  description:
    "A focused catalogue of browser games with practical controls and original play guides.",
  url: new URL(configuredUrl),
} as const;
