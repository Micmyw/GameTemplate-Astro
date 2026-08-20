import { resolveSiteOrigin } from "../lib/site-origin";

type SiteEnvironment = {
  PUBLIC_SITE_NAME?: string;
  PUBLIC_SITE_URL?: string;
};

export const siteInitials = (name: string): string => {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const uppercaseCharacters = words.flatMap(
    (word) => word.match(/[\p{Lu}\p{N}]/gu) ?? [],
  );

  if (uppercaseCharacters.length >= 2) {
    return uppercaseCharacters.slice(0, 2).join("");
  }

  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => [...word][0])
      .join("")
      .toLocaleUpperCase();
  }

  return [...(words[0] ?? "GS")].slice(0, 2).join("").toLocaleUpperCase();
};

export const createSiteConfig = (environment: SiteEnvironment) => ({
  name: environment.PUBLIC_SITE_NAME?.trim() || "GameSite",
  description:
    "A focused catalogue of browser games with practical controls and original play guides.",
  url: resolveSiteOrigin(environment.PUBLIC_SITE_URL),
  socialImage: "/social-card.svg",
});

export const SITE = createSiteConfig({
  PUBLIC_SITE_NAME: import.meta.env.PUBLIC_SITE_NAME,
  PUBLIC_SITE_URL: import.meta.env.PUBLIC_SITE_URL,
});
