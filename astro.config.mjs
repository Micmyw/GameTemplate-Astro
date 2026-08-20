import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

import {
  DEFAULT_SITE_ORIGIN,
  resolveSiteOrigin,
} from "./src/lib/site-origin.ts";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export const resolveAstroMode = (
  argumentsList = process.argv,
  nodeEnvironment = process.env.NODE_ENV,
) => {
  const inlineMode = argumentsList.find((argument) =>
    argument.startsWith("--mode="),
  );
  if (inlineMode) return inlineMode.slice("--mode=".length);

  const modeIndex = argumentsList.indexOf("--mode");
  if (modeIndex >= 0 && argumentsList[modeIndex + 1]) {
    return argumentsList[modeIndex + 1];
  }

  return nodeEnvironment ?? "development";
};

export const createAstroConfig = (mode, root = projectRoot) => {
  const environment = loadEnv(mode, root, "PUBLIC_");

  if (!environment.PUBLIC_SITE_URL && mode === "production") {
    console.warn(
      `[site] PUBLIC_SITE_URL is not set; using documented placeholder ${DEFAULT_SITE_ORIGIN}. Configure the production origin before deployment.`,
    );
  }

  const site = resolveSiteOrigin(environment.PUBLIC_SITE_URL);

  return {
    site: site.origin,
    trailingSlash: "always",
    integrations: [
      sitemap({
        filter: (page) => !page.includes("/admin/"),
      }),
    ],
  };
};

export default defineConfig(createAstroConfig(resolveAstroMode()));
