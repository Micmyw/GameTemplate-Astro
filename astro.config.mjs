import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

const site = process.env.PUBLIC_SITE_URL ?? "https://example.com";

export default defineConfig({
  site,
  trailingSlash: "always",
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/admin/"),
    }),
  ],
});
