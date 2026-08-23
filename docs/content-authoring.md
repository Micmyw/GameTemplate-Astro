# Content authoring guide

Game and category pages are generated from Markdown at build time. Authors can
edit the files directly or use the isolated local CMS Admin at
`http://127.0.0.1:4322/`. From the repository root, `npm run dev` starts Astro
on port 4321, CMS Admin on port 4322, and the Decap local backend on port 8081.
PR 5A does not enable production CMS login.

CMS Admin is a separate static application under `apps/cms-admin`; the public
site never serves a production CMS pathname. This separation is a security
invariant because Decap persists authenticated user data, including the GitHub
token returned by the backend, in origin-scoped `localStorage`.

Keep complete game builds outside this repository. Only editorial Markdown,
cover images, and screenshots belong here. Never add a game package under
`src/` or `public/`.

## Game files

Create one file per game:

```text
src/content/games/<slug>.md
```

The filename is the permanent game ID. Use a lowercase, hyphen-separated slug
and do not rename it after publication without a redirect plan. The Markdown
body below the frontmatter is indexable editorial content and must remain useful
without JavaScript or a loaded iframe.

### Game frontmatter fields

| Field              | Required value                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`            | Visible game name, 1–80 characters. It becomes the page H1.                                                                                      |
| `seoTitle`         | Unique search title, 20–65 characters. Describe this game rather than repeating a site-wide template.                                            |
| `seoDescription`   | Unique search description, 70–170 characters. Do not copy it verbatim into the body.                                                             |
| `shortDescription` | Card and summary copy, 20–200 characters.                                                                                                        |
| `coverImage`       | Repository-relative cover image imported through Astro. This is editorial artwork, not the game package.                                         |
| `coverAlt`         | Non-empty, specific description of the cover's useful visual content. Do not start with “image of”.                                              |
| `screenshots`      | Zero to eight `{ image, alt }` entries. Every `alt` must be non-empty and describe the visible game state.                                       |
| `embedUrl`         | Absolute HTTPS game URL. It must pass all rules in [Embed URL rules](#embed-url-rules).                                                          |
| `categories`       | At least one existing category ID. Use the category filename without `.md`.                                                                      |
| `tags`             | Up to 12 short descriptive tags. Tags do not create public routes.                                                                               |
| `controls`         | At least one `{ input, action }` entry. State the actual input and its result.                                                                   |
| `featured`         | Boolean controlling eligibility for featured lists. It does not publish a draft.                                                                 |
| `mobileSupport`    | One of `yes`, `no`, or `partial`, based on real device testing.                                                                                  |
| `orientation`      | One of `landscape`, `portrait`, or `both`.                                                                                                       |
| `loadMode`         | `click` by default; use `eager` only after the review described below.                                                                           |
| `aspectRatio`      | Two positive integers separated by `/`, for example `16/9` or `4/3`. Values are normalized; zero, negatives, decimals, and text are invalid.     |
| `status`           | `draft` or `published`. A draft game has no generated public page.                                                                               |
| `publishedAt`      | ISO date for first publication, such as `2026-08-20`.                                                                                            |
| `updatedAt`        | ISO date for the current editorial release. It cannot be earlier than `publishedAt`.                                                             |
| `source.name`      | Name of the owner, developer, distributor, or other traceable source.                                                                            |
| `source.url`       | Absolute HTTPS source URL.                                                                                                                       |
| `source.license`   | The actual license or permission basis. Never guess or use vague filler for a production game.                                                   |
| `relatedGames`     | Up to eight existing game IDs. Do not include the current file's own ID. Explicit related games are considered before automatic recommendations. |

An example shape is:

```yaml
---
title: "Example Game"
seoTitle: "Example Game - A Precise Browser Challenge"
seoDescription: "Describe the real objective, controls, and reason to play this specific game in a concise search result summary."
shortDescription: "A short, game-specific card description."
coverImage: "../../assets/images/games/example-game-cover.webp"
coverAlt: "A player crossing the final moving platform"
screenshots:
  - image: "../../assets/images/games/example-game-01.webp"
    alt: "The player waiting for a rotating gate to open"
embedUrl: "https://play.example.com/example-game/index.html"
categories:
  - "skill-games"
tags:
  - "timing"
controls:
  - input: "Arrow keys"
    action: "Move left or right"
featured: false
mobileSupport: "partial"
orientation: "landscape"
loadMode: "click"
aspectRatio: "16/9"
status: "draft"
publishedAt: 2026-08-20
updatedAt: 2026-08-20
source:
  name: "Verified source name"
  url: "https://source.example/"
  license: "Replace with the verified license or permission"
relatedGames: []
---
```

This example intentionally remains a draft. Its `play.example.com` URL is a
placeholder until the package is actually released and tested.

## Embed URL rules

`PUBLIC_GAME_ORIGINS` is a comma-separated allowlist of exact Origins. Each
entry must be an absolute HTTPS Origin only:

```text
https://play.example.com
```

An allowlist entry must not include a path, query, fragment, username, or
password. Duplicate Origins are normalized by the parser. At least one Origin is
required.

Every `embedUrl` must:

- use HTTPS;
- match an allowed Origin by exact Origin equality, not string prefix or
  substring matching;
- use an Origin different from the SEO site's `PUBLIC_SITE_URL` Origin;
- contain no username, password, or fragment;
- end its path with the case-sensitive entry filename `/index.html`;
- use a safe query only when the game genuinely requires it.

The default development Origin is `https://play.example.com`. Production must
replace it with the real, independently controlled game Origin. Never commit a
real `.env` file.

### R2 exact-key URL contract

The production embed URL maps directly to the R2 entry object:

```text
public URL: https://play.example.com/<slug>/index.html
object key: <slug>/index.html
assets: <slug>/assets/<content-hashed-file>
archive: _releases/<slug>/<version>/...
```

Do not assume that `/<slug>/` maps to `<slug>/index.html`. This project does not
add a Worker or rewrite to hide the entry filename. Do not mark a new game
`published` until the exact `/index.html` URL passes browser verification. See
[the R2 deployment guide](deployment/r2.md#exact-key-url-contract).

## Choosing `click` or `eager`

Use `loadMode: "click"` for normal games. The initial HTML contains the cover,
game title, native Play button, controls, categories, related games, and full
editorial body, but no iframe. The game Origin is not requested until the user
selects Play.

Use `loadMode: "eager"` only for a deliberately reviewed core game when all of
the following are true:

- the extra initial network and execution cost is justified;
- privacy and third-party behavior have been reviewed;
- mobile performance has been tested;
- the iframe uses the same validated URL and security attributes as click mode;
- the SEO page remains complete without relying on iframe content.

Changing load mode does not relax Origin, sandbox, license, or content rules.

## Aspect ratio and media

Set `aspectRatio` to the game's real viewport ratio. Both numbers must be
positive integers. Prefer the smallest conventional representation (`16/9`, not
`32/18`) when authoring, even though validation normalizes the value.

Use a cover that makes the game identifiable before Play. Screenshots should
show distinct states rather than repeat the cover. Alt text should communicate
what a sighted player would learn from the image; decorative wording and keyword
stuffing are not useful alternatives.

## Source and license review

Before publishing, retain evidence for:

- the source URL and owner/distributor identity;
- the exact license or written permission;
- whether modification, redistribution, and commercial display are allowed;
- the version/build received;
- any required attribution or notices.

The public `source` fields are not a substitute for preserving the underlying
permission record. If rights are uncertain, keep the entry in draft and do not
upload the package.

## Markdown body

Write genuinely game-specific content. Cover the objective, important mechanics,
control technique, meaningful difficulty, mobile caveats, and any useful player
decisions. Do not generate thin pages by swapping only the game name.

Use normal headings below the page H1. Do not add another H1 in Markdown. The
body, controls, category links, and related games must remain readable before
the game loads and when JavaScript is disabled.

## Category files

Create one category file at:

```text
src/content/categories/<category-id>.md
```

Category frontmatter fields are:

| Field              | Required value                                        |
| ------------------ | ----------------------------------------------------- |
| `name`             | Visible category name, 1–80 characters.               |
| `seoTitle`         | Unique title, 20–65 characters.                       |
| `seoDescription`   | Unique description, 70–170 characters.                |
| `shortDescription` | Card/summary copy, 20–200 characters.                 |
| `order`            | Non-negative integer used for deterministic ordering. |
| `featured`         | Boolean controlling featured-category eligibility.    |
| `status`           | `draft` or `published`.                               |

The Markdown body explains the category's real shared intent. A category page is
generated only when the category is published and contains at least one
published game. A game may reference only real, published categories when it is
published.

## Pre-publication workflow

1. Create or update the game Markdown with `status: "draft"`.
2. Verify every frontmatter field, source, license, image, and alt description.
3. Keep the game package outside this repository and run:

   ```sh
   npm run game:validate -- <LOCAL_PACKAGE>
   ```

4. Treat every validator error as blocking and manually review every warning.
5. Follow [the R2 release workflow](deployment/r2.md): upload immutable assets,
   verify them, and upload `index.html` last. This step is manual and requires
   operator-owned credentials; the repository does not upload anything.
6. Verify the exact `https://play.example.com/<slug>/index.html` URL in a real
   browser; do not substitute the unsupported `/<slug>/` short path.
7. Play through the game on desktop and at least one real or representative
   mobile viewport. Check touch input, orientation, audio behavior, console and
   network failures, reload, and fullscreen handling.
8. Confirm the game cannot navigate the top-level page and does not depend on
   the SEO site's cookies.
9. Set the tested final `embedUrl`, keep its Origin in
   `PUBLIC_GAME_ORIGINS`, and run:

   ```sh
   npm run format:check
   npm run check
   npm run test
   npm run build
   npm run verify:dist
   ```

10. Change `status` to `published` only after the package is live and every
    check passes. Build again before review.

Draft games do not generate public game pages and are excluded from the
Sitemap. Uploading a package does not publish its SEO page; changing the Markdown
status and rebuilding does.

## Updating an existing game

Game code and the SEO page have separate release lifecycles. A game-code update
does not require changing the SEO page URL when the stable, validated `embedUrl`
remains the same.

For every code release:

1. use a new version and new filenames for changed hashed assets;
2. validate and test the package;
3. upload and verify the new assets before changing the entry HTML;
4. preserve the prior entry and release manifest for rollback;
5. update `updatedAt` or editorial copy only when the public page itself changed;
6. replay desktop and mobile acceptance checks.

Never reuse a content-hashed filename for changed bytes. Never publish an
`index.html` that points to resources that are not already present.
