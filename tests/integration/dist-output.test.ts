import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverUnpublishedRoutes,
  verifyDist,
} from "../../scripts/verify-dist.mjs";

const SITE_ORIGIN = "https://fixture.example.test";
const GAME_ORIGIN = "https://play.fixture.example.test";
const SOCIAL_IMAGE = `${SITE_ORIGIN}/social-card.svg`;
const projectRoot = resolve(import.meta.dirname, "../..");

type FixtureFiles = Record<string, string>;
type FixtureMutation = (files: FixtureFiles) => void;

type InvalidFixture = {
  name: string;
  expected: RegExp;
  mutate: FixtureMutation;
};

const temporaryDirectories: string[] = [];

const canonicalTag = (route: string) =>
  `<link rel="canonical" href="${SITE_ORIGIN}${route}">`;

const descriptionTag = (description: string) =>
  `<meta name="description" content="${description}">`;

const robotsTag = (content: string) =>
  `<meta name="robots" content="${content}">`;

const propertyTag = (property: string, content: string) =>
  `<meta property="${property}" content="${content}">`;

const namedMetaTag = (name: string, content: string) =>
  `<meta name="${name}" content="${content}">`;

const safeJson = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

const jsonLdScript = (value: unknown) =>
  `<script type="application/ld+json">${safeJson(value)}</script>`;

const secureFrame = (attributes = "") =>
  `<iframe src="${GAME_ORIGIN}/alpha-roll/" title="Play Alpha Roll" allow="fullscreen; autoplay; gamepad" sandbox="allow-scripts allow-same-origin allow-pointer-lock" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen${attributes}></iframe>`;

const clickGamePlayer =
  () => `<section class="game-player" data-game-player data-load-mode="click" data-src="${GAME_ORIGIN}/alpha-roll/" data-title="Alpha Roll" data-state="idle" style="--game-player-aspect: 16 / 9">
  <div data-game-stage><div data-game-frame-host></div><div data-game-poster><img src="/social-card.svg" alt="Alpha Roll course"><button type="button" data-game-play>Play Alpha Roll</button></div></div>
  <button type="button" data-game-reload disabled>Reload game</button><button type="button" data-game-fullscreen disabled>Fullscreen</button>
  <p data-game-status role="status" aria-live="polite">Ready to play</p>
</section>`;

const eagerGamePlayer = (frame = secureFrame()) =>
  clickGamePlayer()
    .replace('data-load-mode="click"', 'data-load-mode="eager"')
    .replace(
      "<div data-game-frame-host></div>",
      `<div data-game-frame-host>${frame}</div>`,
    );

const websiteSchema = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Fixture Arcade",
  url: `${SITE_ORIGIN}/`,
});

const featuredGamesSchema = () => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      url: `${SITE_ORIGIN}/games/alpha-roll/`,
    },
  ],
});

const gameSchema = () => ({
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Alpha Roll",
  description: "Guide a ball through a compact browser challenge.",
  image: SOCIAL_IMAGE,
  url: `${SITE_ORIGIN}/games/alpha-roll/`,
  gamePlatform: "Web browser",
  genre: ["Ball Games"],
  keywords: ["ball", "skill"],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
});

const gameBreadcrumbSchema = () => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: `${SITE_ORIGIN}/`,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Games",
      item: `${SITE_ORIGIN}/games/`,
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "Alpha Roll",
      item: `${SITE_ORIGIN}/games/alpha-roll/`,
    },
  ],
});

const categorySchema = () => ({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Ball Games",
  description: "Published ball games in the fixture catalogue.",
  url: `${SITE_ORIGIN}/category/ball-games/`,
});

const categoryGamesSchema = () => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      url: `${SITE_ORIGIN}/games/alpha-roll/`,
    },
  ],
});

const categoryBreadcrumbSchema = () => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: `${SITE_ORIGIN}/`,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Ball Games",
      item: `${SITE_ORIGIN}/category/ball-games/`,
    },
  ],
});

type PageOptions = {
  route: string;
  title: string;
  description: string;
  h1: string;
  body?: string;
  robots?: string;
  schemas?: unknown[];
};

const page = ({
  route,
  title,
  description,
  h1,
  body = "",
  robots = "index, follow",
  schemas = [],
}: PageOptions) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width">
    ${descriptionTag(description)}
    ${robotsTag(robots)}
    ${canonicalTag(route)}
    <link rel="icon" href="/favicon.svg">
    ${propertyTag("og:type", "website")}
    ${propertyTag("og:site_name", "Fixture Arcade")}
    ${propertyTag("og:title", title)}
    ${propertyTag("og:description", description)}
    ${propertyTag("og:url", `${SITE_ORIGIN}${route}`)}
    ${propertyTag("og:image", SOCIAL_IMAGE)}
    ${namedMetaTag("twitter:card", "summary_large_image")}
    ${namedMetaTag("twitter:title", title)}
    ${namedMetaTag("twitter:description", description)}
    ${namedMetaTag("twitter:image", SOCIAL_IMAGE)}
    <title>${title}</title>
    ${schemas.map(jsonLdScript).join("\n    ")}
  </head>
  <body>
    <main>
      <h1>${h1}</h1>
      ${body}
    </main>
  </body>
</html>
`;

const sitemap = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((url) => `<url><loc>${url}</loc></url>`)
    .join("")}</urlset>`;

const sitemapUrls = [
  `${SITE_ORIGIN}/`,
  `${SITE_ORIGIN}/games/`,
  `${SITE_ORIGIN}/games/alpha-roll/`,
  `${SITE_ORIGIN}/category/ball-games/`,
];

const validFixture = (): FixtureFiles => ({
  "index.html": page({
    route: "/",
    title: "Fixture Arcade | Browser game guides",
    description: "Browse focused browser game guides in the fixture catalogue.",
    h1: "Choose a browser game",
    body: `<nav><a href="/games/">All games</a><a href="/category/ball-games/">Ball games</a></nav>`,
    schemas: [websiteSchema(), featuredGamesSchema()],
  }),
  "games/index.html": page({
    route: "/games/",
    title: "All browser games | Fixture Arcade",
    description:
      "Browse every published browser game in the fixture catalogue.",
    h1: "All games",
    body: `<a href="/games/alpha-roll/">Alpha Roll</a>`,
  }),
  "games/alpha-roll/index.html": page({
    route: "/games/alpha-roll/",
    title: "Alpha Roll browser game | Fixture Arcade",
    description: "Read the controls and original play guide for Alpha Roll.",
    h1: "Alpha Roll",
    body: `${clickGamePlayer()}
      <div class="game-info-strip"><a href="/category/ball-games/">Ball Games</a></div>
      <section class="game-copy"><div class="prose"><p>Preserve momentum, read each turn early, and use short corrections to keep the ball on the route.</p></div></section>`,
    schemas: [gameSchema(), gameBreadcrumbSchema()],
  }),
  "category/ball-games/index.html": page({
    route: "/category/ball-games/",
    title: "Ball Games collection | Fixture Arcade",
    description: "Browse the published ball games in the fixture catalogue.",
    h1: "Ball Games",
    body: `<a href="/games/alpha-roll/">Alpha Roll</a>`,
    schemas: [
      categorySchema(),
      categoryGamesSchema(),
      categoryBreadcrumbSchema(),
    ],
  }),
  "404.html": page({
    route: "/404.html",
    title: "Page not found | Fixture Arcade",
    description: "The requested fixture catalogue route could not be found.",
    h1: "That page could not be found",
    body: `<a href="/">Return home</a>`,
    robots: "noindex, follow",
  }),
  "robots.txt": `User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${SITE_ORIGIN}/sitemap-index.xml\n`,
  "sitemap-index.xml": `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${SITE_ORIGIN}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
  "sitemap-0.xml": sitemap(sitemapUrls),
  "favicon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>`,
  "social-card.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630"/></svg>`,
});

async function createDist(files: FixtureFiles) {
  const root = await mkdtemp(join(tmpdir(), "game-site-dist-"));
  temporaryDirectories.push(root);

  for (const [file, contents] of Object.entries(files)) {
    const destination = join(root, file);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }

  return root;
}

const verifyFixture = (distDirectory: string) =>
  verifyDist(distDirectory, {
    expectedSiteOrigin: SITE_ORIGIN,
    allowedGameOrigins: [new URL(GAME_ORIGIN)],
    excludedRoutes: ["/games/obstacle-orbit/"],
  });

function replaceRequired(
  files: FixtureFiles,
  file: string,
  search: string,
  replacement: string,
) {
  const contents = files[file];
  if (contents === undefined || !contents.includes(search)) {
    throw new Error(`Fixture mutation could not find text in ${file}`);
  }

  files[file] = contents.replace(search, replacement);
}

function removeRequired(files: FixtureFiles, file: string, search: string) {
  replaceRequired(files, file, search, "");
}

function appendSitemapUrl(files: FixtureFiles, url: string) {
  replaceRequired(
    files,
    "sitemap-0.xml",
    "</urlset>",
    `<url><loc>${url}</loc></url></urlset>`,
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("launch-quality dist verification", () => {
  it("discovers the real unpublished game route used by the CLI gate", async () => {
    await expect(discoverUnpublishedRoutes(projectRoot)).resolves.toContain(
      "/games/obstacle-orbit/",
    );
  });

  it("recursively accepts every page in a complete valid static build", async () => {
    const distDirectory = await createDist(validFixture());

    const result = await verifyFixture(distDirectory);

    expect(new Set(result.checkedFiles)).toEqual(
      new Set([
        "404.html",
        "category/ball-games/index.html",
        "games/alpha-roll/index.html",
        "games/index.html",
        "index.html",
      ]),
    );
  });

  it("accepts an eager player only when its initial iframe is secured", async () => {
    const files = validFixture();
    replaceRequired(
      files,
      "games/alpha-roll/index.html",
      clickGamePlayer(),
      eagerGamePlayer(),
    );
    const distDirectory = await createDist(files);

    await expect(verifyFixture(distDirectory)).resolves.toBeTruthy();
  });

  const requiredInvalidFixtures: InvalidFixture[] = [
    {
      name: "duplicate title elements",
      expected:
        /(?:duplicate|exactly one).*title|title.*(?:duplicate|exactly one)/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "index.html",
          "<title>Fixture Arcade | Browser game guides</title>",
          "<title>Fixture Arcade | Browser game guides</title><title>Duplicate title</title>",
        );
      },
    },
    {
      name: "duplicate canonical elements",
      expected:
        /(?:duplicate|exactly one).*canonical|canonical.*(?:duplicate|exactly one)/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          canonicalTag("/games/alpha-roll/"),
          `${canonicalTag("/games/alpha-roll/")}${canonicalTag("/games/alpha-roll/")}`,
        );
      },
    },
    {
      name: "missing description",
      expected: /description/i,
      mutate: (files) => {
        removeRequired(
          files,
          "index.html",
          descriptionTag(
            "Browse focused browser game guides in the fixture catalogue.",
          ),
        );
      },
    },
    {
      name: "multiple H1 elements",
      expected: /(?:multiple|exactly one).*h1|h1.*(?:multiple|exactly one)/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          "<h1>Alpha Roll</h1>",
          "<h1>Alpha Roll</h1><h1>Duplicate heading</h1>",
        );
      },
    },
    {
      name: "broken internal link",
      expected: /internal link|missing\//i,
      mutate: (files) => {
        replaceRequired(
          files,
          "index.html",
          'href="/games/"',
          'href="/missing/"',
        );
      },
    },
    {
      name: "malformed JSON-LD",
      expected: /JSON-LD|JSON/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          jsonLdScript(gameSchema()),
          `<script type="application/ld+json">{"@type":"VideoGame",}</script>`,
        );
      },
    },
    {
      name: "unsafe JSON-LD script content",
      expected: /unsafe.*JSON-LD|JSON-LD.*unsafe|literal.*</i,
      mutate: (files) => {
        replaceRequired(
          files,
          "index.html",
          jsonLdScript(websiteSchema()),
          `<script type="application/ld+json">${JSON.stringify({
            ...websiteSchema(),
            name: "Fixture < Arcade",
          })}</script>`,
        );
      },
    },
    {
      name: "draft URL in Sitemap",
      expected: /obstacle-orbit|Sitemap.*(?:generated|indexable|canonical)/i,
      mutate: (files) => {
        appendSitemapUrl(files, `${SITE_ORIGIN}/games/obstacle-orbit/`);
      },
    },
    {
      name: "admin URL in Sitemap",
      expected: /admin.*Sitemap|Sitemap.*admin/i,
      mutate: (files) => {
        appendSitemapUrl(files, `${SITE_ORIGIN}/admin/`);
      },
    },
    {
      name: "404 URL in Sitemap",
      expected: /404.*Sitemap|Sitemap.*404/i,
      mutate: (files) => {
        appendSitemapUrl(files, `${SITE_ORIGIN}/404.html`);
      },
    },
    {
      name: "canonical without a trailing slash",
      expected: /canonical.*trailing slash|trailing slash.*canonical/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          canonicalTag("/games/alpha-roll/"),
          `<link rel="canonical" href="${SITE_ORIGIN}/games/alpha-roll">`,
        );
      },
    },
    {
      name: "canonical and route mismatch",
      expected: /canonical.*route|route.*canonical/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          canonicalTag("/games/alpha-roll/"),
          canonicalTag("/games/not-alpha-roll/"),
        );
      },
    },
    {
      name: "canonical and Sitemap origin mismatch",
      expected: /Sitemap.*origin|origin.*Sitemap/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "sitemap-0.xml",
          `${SITE_ORIGIN}/games/alpha-roll/`,
          "https://other.example.test/games/alpha-roll/",
        );
      },
    },
    {
      name: "missing required schema type",
      expected: /BreadcrumbList|schema/i,
      mutate: (files) => {
        removeRequired(
          files,
          "games/alpha-roll/index.html",
          jsonLdScript(gameBreadcrumbSchema()),
        );
      },
    },
    {
      name: "a game page without a GamePlayer root",
      expected: /GamePlayer.*root|root.*GamePlayer/i,
      mutate: (files) => {
        removeRequired(files, "games/alpha-roll/index.html", clickGamePlayer());
      },
    },
    {
      name: "a click player without a native Play button",
      expected: /Play button|button.*Play/i,
      mutate: (files) => {
        removeRequired(
          files,
          "games/alpha-roll/index.html",
          '<button type="button" data-game-play>Play Alpha Roll</button>',
        );
      },
    },
    {
      name: "a click player with an initial iframe",
      expected: /click.*iframe|iframe.*click/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          "<div data-game-frame-host></div>",
          `<div data-game-frame-host>${secureFrame()}</div>`,
        );
      },
    },
    {
      name: "a player with an HTTP data source",
      expected: /data-src.*HTTPS|HTTPS.*data-src/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          `${GAME_ORIGIN}/alpha-roll/`,
          "http://play.fixture.example.test/alpha-roll/",
        );
      },
    },
    {
      name: "a player whose data source Origin is not allowed",
      expected: /data-src.*allowed|origin.*allowed|not allowed/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          `${GAME_ORIGIN}/alpha-roll/`,
          "https://unlisted.example.test/alpha-roll/",
        );
      },
    },
    {
      name: "a player whose data source matches the main site Origin",
      expected: /different origins|same.origin|main site/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          `${GAME_ORIGIN}/alpha-roll/`,
          `${SITE_ORIGIN}/alpha-roll/`,
        );
      },
    },
    {
      name: "an eager iframe without sandbox",
      expected: /iframe.*sandbox|sandbox.*iframe/i,
      mutate: (files) => {
        const frame = secureFrame().replace(
          ' sandbox="allow-scripts allow-same-origin allow-pointer-lock"',
          "",
        );
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          clickGamePlayer(),
          eagerGamePlayer(frame),
        );
      },
    },
    {
      name: "an eager game page with a second iframe outside its player root",
      expected: /eager.*exactly one.*iframe|iframe.*eager/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          clickGamePlayer(),
          `${eagerGamePlayer()}${secureFrame()}`,
        );
      },
    },
    {
      name: "an eager iframe with allow-popups",
      expected: /allow-popups|sandbox/i,
      mutate: (files) => {
        const frame = secureFrame().replace(
          "allow-pointer-lock",
          "allow-pointer-lock allow-popups",
        );
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          clickGamePlayer(),
          eagerGamePlayer(frame),
        );
      },
    },
    {
      name: "an eager iframe with allow-top-navigation",
      expected: /allow-top-navigation|sandbox/i,
      mutate: (files) => {
        const frame = secureFrame().replace(
          "allow-pointer-lock",
          "allow-pointer-lock allow-top-navigation",
        );
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          clickGamePlayer(),
          eagerGamePlayer(frame),
        );
      },
    },
    ...(["camera", "microphone", "geolocation"] as const).map(
      (permission): InvalidFixture => ({
        name: `an eager iframe that allows ${permission}`,
        expected: new RegExp(`${permission}|iframe.*allow|allow.*iframe`, "i"),
        mutate: (files) => {
          const frame = secureFrame().replace(
            "fullscreen; autoplay; gamepad",
            `fullscreen; autoplay; gamepad; ${permission}`,
          );
          replaceRequired(
            files,
            "games/alpha-roll/index.html",
            clickGamePlayer(),
            eagerGamePlayer(frame),
          );
        },
      }),
    ),
  ];

  it.each(requiredInvalidFixtures)(
    "rejects $name",
    async ({ mutate, expected }) => {
      const files = validFixture();
      mutate(files);
      const distDirectory = await createDist(files);

      await expect(verifyFixture(distDirectory)).rejects.toThrow(expected);
    },
  );

  const additionalInvalidFixtures: InvalidFixture[] = [
    {
      name: "a missing index page",
      expected: /index\.html.*missing/i,
      mutate: (files) => {
        delete files["index.html"];
      },
    },
    {
      name: "a missing 404 page",
      expected: /404\.html.*missing/i,
      mutate: (files) => {
        delete files["404.html"];
      },
    },
    {
      name: "a missing title",
      expected: /title/i,
      mutate: (files) => {
        removeRequired(
          files,
          "index.html",
          "<title>Fixture Arcade | Browser game guides</title>",
        );
      },
    },
    {
      name: "an empty title",
      expected: /title/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "index.html",
          "<title>Fixture Arcade | Browser game guides</title>",
          "<title>   </title>",
        );
      },
    },
    {
      name: "a final title longer than 65 characters",
      expected: /title.*65|65.*title/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "index.html",
          "<title>Fixture Arcade | Browser game guides</title>",
          `<title>${"A".repeat(66)}</title>`,
        );
      },
    },
    {
      name: "the same title value on two pages",
      expected: /title.*unique|duplicate.*title|title.*duplicate/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/index.html",
          "<title>All browser games | Fixture Arcade</title>",
          "<title>Fixture Arcade | Browser game guides</title>",
        );
      },
    },
    {
      name: "an empty description",
      expected: /description/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "index.html",
          descriptionTag(
            "Browse focused browser game guides in the fixture catalogue.",
          ),
          descriptionTag("   "),
        );
      },
    },
    {
      name: "a missing canonical",
      expected: /canonical/i,
      mutate: (files) => {
        removeRequired(files, "games/index.html", canonicalTag("/games/"));
      },
    },
    {
      name: "a non-HTTPS canonical",
      expected: /canonical.*HTTPS|HTTPS.*canonical/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/index.html",
          canonicalTag("/games/"),
          `<link rel="canonical" href="http://fixture.example.test/games/">`,
        );
      },
    },
    {
      name: "a canonical on a foreign origin",
      expected: /canonical.*origin|origin.*canonical/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/index.html",
          canonicalTag("/games/"),
          `<link rel="canonical" href="https://other.example.test/games/">`,
        );
      },
    },
    {
      name: "an internally consistent build on the wrong configured origin",
      expected: /configured.*origin|origin.*configured/i,
      mutate: (files) => {
        for (const file of Object.keys(files)) {
          files[file] =
            files[file]?.replaceAll(
              SITE_ORIGIN,
              "https://wrong.example.test",
            ) ?? "";
        }
      },
    },
    {
      name: "a page without an H1",
      expected: /h1/i,
      mutate: (files) => {
        removeRequired(files, "games/index.html", "<h1>All games</h1>");
      },
    },
    {
      name: "a page with an empty H1",
      expected: /h1/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/index.html",
          "<h1>All games</h1>",
          "<h1>   </h1>",
        );
      },
    },
    {
      name: "undefined serialized as a JSON-LD string",
      expected: /undefined.*JSON-LD|JSON-LD.*undefined/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "index.html",
          jsonLdScript(websiteSchema()),
          jsonLdScript({ ...websiteSchema(), name: "undefined" }),
        );
      },
    },
    {
      name: "a relative JSON-LD URL",
      expected: /JSON-LD.*URL|URL.*JSON-LD/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "index.html",
          jsonLdScript(websiteSchema()),
          jsonLdScript({ ...websiteSchema(), url: "/" }),
        );
      },
    },
    {
      name: "a primary schema URL that disagrees with the page canonical",
      expected: /schema.*canonical|canonical.*schema/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          jsonLdScript(gameSchema()),
          jsonLdScript({ ...gameSchema(), url: `${SITE_ORIGIN}/games/` }),
        );
      },
    },
    {
      name: "a game page without body text",
      expected: /game.*body|body.*game/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          '<div class="prose"><p>Preserve momentum, read each turn early, and use short corrections to keep the ball on the route.</p></div>',
          '<div class="prose">   </div>',
        );
      },
    },
    {
      name: "a game page without a category link",
      expected: /game.*category link|category link.*game/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/alpha-roll/index.html",
          `<a href="/category/ball-games/">Ball Games</a>`,
          `<span>Ball Games</span>`,
        );
      },
    },
    {
      name: "a homepage without WebSite schema",
      expected: /WebSite|schema/i,
      mutate: (files) => {
        removeRequired(files, "index.html", jsonLdScript(websiteSchema()));
      },
    },
    {
      name: "a homepage without featured ItemList schema",
      expected: /ItemList|schema/i,
      mutate: (files) => {
        removeRequired(
          files,
          "index.html",
          jsonLdScript(featuredGamesSchema()),
        );
      },
    },
    {
      name: "a category page without CollectionPage schema",
      expected: /CollectionPage|schema/i,
      mutate: (files) => {
        removeRequired(
          files,
          "category/ball-games/index.html",
          jsonLdScript(categorySchema()),
        );
      },
    },
    {
      name: "a category page without ItemList schema",
      expected: /ItemList|schema/i,
      mutate: (files) => {
        removeRequired(
          files,
          "category/ball-games/index.html",
          jsonLdScript(categoryGamesSchema()),
        );
      },
    },
    {
      name: "a missing robots.txt",
      expected: /robots\.txt.*missing|missing.*robots\.txt/i,
      mutate: (files) => {
        delete files["robots.txt"];
      },
    },
    {
      name: "a wrong robots Sitemap URL",
      expected: /robots.*Sitemap|Sitemap.*robots/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "robots.txt",
          `${SITE_ORIGIN}/sitemap-index.xml`,
          "https://other.example.test/sitemap-index.xml",
        );
      },
    },
    {
      name: "a missing Sitemap index",
      expected: /sitemap-index\.xml.*missing|missing.*sitemap-index\.xml/i,
      mutate: (files) => {
        delete files["sitemap-index.xml"];
      },
    },
    {
      name: "a missing referenced child Sitemap",
      expected: /sitemap-0\.xml.*missing|missing.*sitemap-0\.xml/i,
      mutate: (files) => {
        delete files["sitemap-0.xml"];
      },
    },
    {
      name: "a duplicate Sitemap page URL",
      expected: /duplicate.*Sitemap|Sitemap.*duplicate/i,
      mutate: (files) => {
        appendSitemapUrl(files, `${SITE_ORIGIN}/games/`);
      },
    },
    {
      name: "a Sitemap missing an indexable page",
      expected: /Sitemap.*canonical|canonical.*Sitemap/i,
      mutate: (files) => {
        removeRequired(
          files,
          "sitemap-0.xml",
          `<url><loc>${SITE_ORIGIN}/games/</loc></url>`,
        );
      },
    },
    {
      name: "a generated draft page included in the Sitemap",
      expected: /unpublished.*obstacle-orbit|obstacle-orbit.*unpublished/i,
      mutate: (files) => {
        const draftRoute = "/games/obstacle-orbit/";
        files["games/obstacle-orbit/index.html"] = page({
          route: draftRoute,
          title: "Obstacle Orbit draft game | Fixture Arcade",
          description:
            "A complete draft fixture that must remain outside generated output.",
          h1: "Obstacle Orbit",
          body: `<div class="game-info-strip"><a href="/category/ball-games/">Ball Games</a></div>
            <section class="game-copy"><div class="prose"><p>This complete page proves that generated drafts are rejected even when their metadata and links are otherwise valid.</p></div></section>`,
          schemas: [
            {
              ...gameSchema(),
              name: "Obstacle Orbit",
              url: `${SITE_ORIGIN}${draftRoute}`,
            },
            {
              ...gameBreadcrumbSchema(),
              itemListElement: [
                ...gameBreadcrumbSchema().itemListElement.slice(0, 2),
                {
                  "@type": "ListItem",
                  position: 3,
                  name: "Obstacle Orbit",
                  item: `${SITE_ORIGIN}${draftRoute}`,
                },
              ],
            },
          ],
        });
        appendSitemapUrl(files, `${SITE_ORIGIN}${draftRoute}`);
      },
    },
    {
      name: "a non-HTTPS Sitemap page URL",
      expected: /Sitemap.*HTTPS|HTTPS.*Sitemap/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "sitemap-0.xml",
          `${SITE_ORIGIN}/games/`,
          "http://fixture.example.test/games/",
        );
      },
    },
    {
      name: "a Sitemap page URL without a trailing slash",
      expected: /Sitemap.*trailing slash|trailing slash.*Sitemap/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "sitemap-0.xml",
          `${SITE_ORIGIN}/games/alpha-roll/`,
          `${SITE_ORIGIN}/games/alpha-roll`,
        );
      },
    },
    {
      name: "a 404 page without noindex",
      expected: /404.*noindex|noindex.*404/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "404.html",
          robotsTag("noindex, follow"),
          robotsTag("index, follow"),
        );
      },
    },
    {
      name: "an indexable page without robots metadata",
      expected: /robots/i,
      mutate: (files) => {
        removeRequired(files, "games/index.html", robotsTag("index, follow"));
      },
    },
    {
      name: "an indexable page marked noindex",
      expected: /noindex|indexable/i,
      mutate: (files) => {
        replaceRequired(
          files,
          "games/index.html",
          robotsTag("index, follow"),
          robotsTag("noindex, follow"),
        );
      },
    },
  ];

  it.each(additionalInvalidFixtures)(
    "rejects $name",
    async ({ mutate, expected }) => {
      const files = validFixture();
      mutate(files);
      const distDirectory = await createDist(files);

      await expect(verifyFixture(distDirectory)).rejects.toThrow(expected);
    },
  );

  const requiredOpenGraphFields = [
    "og:type",
    "og:site_name",
    "og:title",
    "og:description",
    "og:url",
    "og:image",
  ] as const;

  it.each(requiredOpenGraphFields)(
    "rejects an indexable page without %s",
    async (property) => {
      const files = validFixture();
      const values: Record<(typeof requiredOpenGraphFields)[number], string> = {
        "og:type": "website",
        "og:site_name": "Fixture Arcade",
        "og:title": "Fixture Arcade | Browser game guides",
        "og:description":
          "Browse focused browser game guides in the fixture catalogue.",
        "og:url": `${SITE_ORIGIN}/`,
        "og:image": SOCIAL_IMAGE,
      };
      removeRequired(
        files,
        "index.html",
        propertyTag(property, values[property]),
      );
      const distDirectory = await createDist(files);

      await expect(verifyFixture(distDirectory)).rejects.toThrow(
        new RegExp(property, "i"),
      );
    },
  );

  const requiredTwitterFields = [
    "twitter:card",
    "twitter:title",
    "twitter:description",
    "twitter:image",
  ] as const;

  it.each(requiredTwitterFields)(
    "rejects an indexable page without %s",
    async (name) => {
      const files = validFixture();
      const values: Record<(typeof requiredTwitterFields)[number], string> = {
        "twitter:card": "summary_large_image",
        "twitter:title": "Fixture Arcade | Browser game guides",
        "twitter:description":
          "Browse focused browser game guides in the fixture catalogue.",
        "twitter:image": SOCIAL_IMAGE,
      };
      removeRequired(files, "index.html", namedMetaTag(name, values[name]));
      const distDirectory = await createDist(files);

      await expect(verifyFixture(distDirectory)).rejects.toThrow(
        new RegExp(name, "i"),
      );
    },
  );
});
