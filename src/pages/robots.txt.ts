import type { APIRoute } from "astro";

import { absoluteUrl } from "../lib/urls";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin/",
      `Sitemap: ${absoluteUrl("/sitemap-index.xml")}`,
      "",
    ].join("\n"),
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    },
  );
