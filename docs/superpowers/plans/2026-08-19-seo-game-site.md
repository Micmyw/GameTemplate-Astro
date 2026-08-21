# SEO Game Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, SEO-first multi-game portal using Astro Content Collections, secure iframe embedding, a Git-backed CMS, Cloudflare Workers Static Assets, and R2-hosted games.

**Architecture:** All indexable pages are pre-rendered at build time. Game metadata and editorial content live in Markdown, while game executables are hosted separately on `play.example.com` and loaded through validated iframes. GitHub is the content database; Decap CMS writes commits; Cloudflare serves the static main site and R2 game assets.

**Tech Stack:** Node.js 24 LTS, npm, Astro v7, TypeScript strict, Astro Content Collections, Vitest, Cheerio, Playwright, Decap CMS, Cloudflare Workers Static Assets, Wrangler v4+, Cloudflare R2.

**Spec:** `docs/superpowers/specs/2026-08-19-seo-game-site-design.md`

## Global Constraints

- Keep Astro in static output mode; never set `output: "server"`.
- Do not install `@astrojs/cloudflare` for the main site.
- Do not add a database, API server, Redis, D1, Supabase, or runtime SSR.
- Do not place complete game builds under the main site's `src/` or `public/`.
- All published game and category routes must be generated at build time.
- All SEO-critical content must exist in the first HTML response.
- Use npm only and commit exactly one `package-lock.json`.
- Use Node.js 24 LTS.
- Use system fonts; do not load Google Fonts.
- Use no client framework runtime.
- All production iframe URLs must be HTTPS and pass the configured origin allowlist.
- All production iframe paths must end with the case-sensitive `/index.html` entry filename.
- Secrets must be stored in GitHub or Cloudflare secret stores, never in Git.
- Every production-code behavior follows Red → Green → Refactor.
- Every task ends with fresh verification evidence and a focused commit.
- Each PR remains a draft until independent review is complete.
- Do not begin the next PR until the current PR is merged.

---

# File Structure

The completed repository will use this structure:

```text
.
├── AGENTS.md
├── .env.example
├── .nvmrc
├── astro.config.mjs
├── package.json
├── package-lock.json
├── tsconfig.json
├── wrangler.jsonc
├── public/
│   ├── _headers
│   ├── _redirects
│   ├── admin/
│   │   ├── index.html
│   │   ├── config.yml
│   │   └── preview.css
│   └── assets/
├── src/
│   ├── assets/images/games/
│   ├── components/
│   │   ├── ads/AdSlot.astro
│   │   ├── games/GameCard.astro
│   │   ├── games/GameControls.astro
│   │   ├── games/GamePlayer.astro
│   │   ├── games/RelatedGames.astro
│   │   ├── layout/Footer.astro
│   │   ├── layout/Header.astro
│   │   └── seo/JsonLd.astro
│   ├── config/
│   │   ├── ads.ts
│   │   └── site.ts
│   ├── content/
│   │   ├── categories/
│   │   └── games/
│   ├── content.config.ts
│   ├── layouts/BaseLayout.astro
│   ├── lib/
│   │   ├── content/categories.ts
│   │   ├── content/games.ts
│   │   ├── related-games.ts
│   │   ├── seo.ts
│   │   └── urls.ts
│   ├── pages/
│   │   ├── 404.astro
│   │   ├── about.astro
│   │   ├── category/[id].astro
│   │   ├── games/[id].astro
│   │   ├── games/index.astro
│   │   ├── index.astro
│   │   ├── privacy.astro
│   │   ├── robots.txt.ts
│   │   └── terms.astro
│   └── styles/
│       ├── global.css
│       └── tokens.css
├── scripts/
│   └── verify-dist.mjs
├── tests/
│   ├── e2e/public-pages.spec.ts
│   ├── integration/dist-output.test.ts
│   └── unit/
├── apps/
│   └── cms-auth/
├── docs/
│   ├── content-authoring.md
│   ├── deployment/r2.md
│   ├── deployment/workers-static-assets.md
│   ├── review/acceptance-checklist.md
│   └── superpowers/
│       ├── plans/2026-08-19-seo-game-site.md
│       └── specs/2026-08-19-seo-game-site-design.md
└── .github/workflows/ci.yml
```

---

# PR 1 — Foundation, Toolchain, and CI Baseline

**Branch:** `feat/game-site-foundation`  
**PR title:** `feat: establish Astro game-site foundation`

## Task 1: Initialize the repository in an isolated worktree

**Files:**
- Create: `.nvmrc`
- Create: `.env.example`
- Create: `AGENTS.md`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `src/pages/index.astro`
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `docs/superpowers/specs/2026-08-19-seo-game-site-design.md`
- Create: `docs/superpowers/plans/2026-08-19-seo-game-site.md`

**Interfaces:**
- Produces: a static Astro v7 project with npm scripts and strict TypeScript.
- Consumes: no earlier project code.

- [ ] **Step 1: Detect whether the current checkout is already isolated**

Run:

```bash
git rev-parse --show-toplevel
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git status --short
```

Expected:

- repository path resolves;
- working tree is clean;
- current branch is not `main` before implementation begins.

When not already isolated, create:

```bash
git worktree add .worktrees/game-site-foundation -b feat/game-site-foundation
cd .worktrees/game-site-foundation
```

Before creation, verify `.worktrees/` is ignored:

```bash
git check-ignore -q .worktrees
```

When it is not ignored, add `.worktrees/` to `.gitignore`, commit that change on the current maintenance branch, then create the worktree.

- [ ] **Step 2: Initialize Astro minimal**

When the repository contains no application files, run the Astro CLI and choose:

```text
Template: minimal
Install dependencies: yes
Initialize git: no
TypeScript: strict
```

Use:

```bash
npm create astro@latest
```

When an Astro application already exists, do not overwrite it. Inspect the current files and adapt them to the same final structure.

- [ ] **Step 3: Pin the runtime**

Create `.nvmrc`:

```text
24
```

Add to `package.json`:

```json
{
  "engines": {
    "node": ">=24 <25"
  }
}
```

- [ ] **Step 4: Install foundation dependencies**

Run:

```bash
npm install @astrojs/sitemap
npm install -D @astrojs/check typescript vitest prettier prettier-plugin-astro wrangler@latest
```

Do not install React, Vue, Svelte, Tailwind, a database client, or an Astro server adapter.

- [ ] **Step 5: Define package scripts**

Use this script contract:

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "verify:dist": "node scripts/verify-dist.mjs",
    "deploy:dry": "npm run build && npm run verify:dist && wrangler deploy --dry-run",
    "deploy": "npm run format:check && npm run check && npm run test && npm run build && npm run verify:dist && wrangler deploy"
  }
}
```

`verify:dist` may temporarily point to a minimal script in this PR and will be expanded in PR 3.

- [ ] **Step 6: Add environment defaults**

Create `.env.example`:

```dotenv
PUBLIC_SITE_NAME=GameSite
PUBLIC_SITE_URL=https://example.com
PUBLIC_GAME_ORIGINS=https://play.example.com
```

Do not create or commit `.env`.

- [ ] **Step 7: Configure Astro for static output**

`astro.config.mjs` must:

- set `site` from `PUBLIC_SITE_URL`, falling back to `https://example.com`;
- add the Sitemap integration;
- filter `/admin/`;
- preserve Astro's default static output;
- never import a Cloudflare adapter.

Example shape:

```js
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

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
```

- [ ] **Step 8: Add strict TypeScript configuration**

`tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strictest",
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

- [ ] **Step 9: Add a minimal accessible shell**

Create only:

- semantic header;
- main region;
- footer;
- one H1;
- system font stack;
- responsive width;
- visible keyboard focus;
- no final branding;
- no copied competitor styling.

- [ ] **Step 10: Add a minimal dist verifier**

Create `scripts/verify-dist.mjs` that fails when:

- `dist/index.html` does not exist;
- `dist/404.html` does not exist after the 404 page is added later;
- any built HTML contains `data-astro-cid` is not a failure;
- any built HTML lacks a `<title>`.

For PR 1, allow the missing 404 check to be disabled until Task 2 adds the page.

- [ ] **Step 11: Run baseline verification**

Run:

```bash
npm run format
npm run format:check
npm run check
npm run test
npm run build
```

Expected:

- all commands exit 0;
- `dist/index.html` exists;
- no SSR server bundle exists.

- [ ] **Step 12: Commit**

```bash
git add .
git commit -m "chore: initialize static Astro game site"
```

## Task 2: Add Cloudflare Static Assets configuration and security headers

**Files:**
- Create: `wrangler.jsonc`
- Create: `public/_headers`
- Create: `public/_redirects`
- Create: `src/pages/404.astro`
- Modify: `scripts/verify-dist.mjs`
- Test: `tests/unit/cloudflare-config.test.ts`

**Interfaces:**
- Produces: `wrangler.jsonc` with no Worker entry point.
- Produces: security header and custom 404 behavior.
- Consumes: the static `dist/` directory from Task 1.

- [ ] **Step 1: Write a failing config test**

Test must parse `wrangler.jsonc` after removing JSONC comments and assert:

- `assets.directory === "./dist"`;
- `assets.not_found_handling === "404-page"`;
- `assets.html_handling === "auto-trailing-slash"`;
- no `main` key;
- no `d1_databases`, `kv_namespaces`, or `r2_buckets` keys for the main site.

Run:

```bash
npm test -- tests/unit/cloudflare-config.test.ts
```

Expected: FAIL because the config does not exist.

- [ ] **Step 2: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "game-site",
  "compatibility_date": "2026-08-19",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash"
  }
}
```

- [ ] **Step 3: Add static headers**

Create `public/_headers` exactly with these initial rules:

```text
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  X-Frame-Options: DENY

/admin/*
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store

https://:version.:subdomain.workers.dev/*
  X-Robots-Tag: noindex, nofollow

/_astro/*
  Cache-Control: public, max-age=31536000, immutable
```

- [ ] **Step 4: Add the 404 page**

The built 404 page must:

- contain a unique title;
- contain `noindex, follow`;
- link to `/`;
- defer the `/games/` recovery link to PR 2, after the `/games/` route exists;
- not use client-side routing.

- [ ] **Step 5: Expand dist verification**

`verify-dist.mjs` must now fail unless:

- `dist/index.html` exists;
- `dist/404.html` exists;
- both contain a title;
- 404 contains `noindex`.

- [ ] **Step 6: Verify Red → Green**

Run:

```bash
npm test -- tests/unit/cloudflare-config.test.ts
npm run build
npm run verify:dist
npx wrangler deploy --dry-run
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add wrangler.jsonc public/_headers public/_redirects src/pages/404.astro scripts/verify-dist.mjs tests/unit/cloudflare-config.test.ts
git commit -m "chore: configure Workers static asset deployment"
```

## Task 3: Add CI without production deployment

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `docs/review/acceptance-checklist.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: required PR checks.
- Does not deploy.

- [ ] **Step 1: Write the CI workflow**

Triggers:

```yaml
on:
  pull_request:
  push:
    branches: [main]
```

Use Node 24 and run:

```bash
npm ci
npm run format:check
npm run check
npm run test
npm run build
npm run verify:dist
npx wrangler deploy --dry-run
```

Do not add Cloudflare secrets and do not deploy on main.

- [ ] **Step 2: Add acceptance checklist**

The checklist must include:

- static output confirmed;
- no game build committed;
- no secrets;
- tests and build output;
- screenshots for visible changes;
- source HTML inspection;
- SEO checks;
- iframe allowlist checks;
- CI link;
- deviations from the design spec.

- [ ] **Step 3: Update `AGENTS.md`**

`AGENTS.md` must direct Codex to:

- read the design and current PR section;
- implement one PR only;
- use TDD;
- keep commits focused;
- run fresh verification before claiming success;
- never merge;
- open a Draft PR;
- stop after reporting the PR URL and evidence.

- [ ] **Step 4: Verify workflow syntax**

Run a YAML parser or inspect with GitHub after push. Locally run every command from the workflow.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml docs/review/acceptance-checklist.md AGENTS.md
git commit -m "ci: add static-site quality gates"
```

## PR 1 Completion Gate

Run fresh:

```bash
npm ci
npm run format:check
npm run check
npm run test
npm run build
npm run verify:dist
npx wrangler deploy --dry-run
git status --short
git log --oneline origin/main..HEAD
```

Required:

- zero command failures;
- clean worktree;
- no untracked files;
- no server output;
- no production deploy;
- Draft PR opened.

Stop and provide:

- Draft PR URL;
- base and head SHA;
- command outputs;
- file count and summary;
- known deviations, or explicitly state none.

---

# PR 2 — Content Model, Query Layer, and Static Routes

**Branch:** `feat/game-content-and-routes`  
**PR title:** `feat: add typed game content and static routes`

Start from updated `main` after PR 1 merge.

## Task 4: Define typed content collections

**Files:**
- Create: `src/content.config.ts`
- Create: `src/content/categories/ball-games.md`
- Create: `src/content/categories/skill-games.md`
- Create: `src/content/games/going-balls.md`
- Create: `src/content/games/roll-ball-3d.md`
- Create: `src/content/games/obstacle-orbit.md`
- Create: sample images under `src/assets/images/games/`
- Test: `tests/unit/content-schema.test.ts`

**Interfaces:**
- Produces: collections named exactly `"games"` and `"categories"`.
- Produces: game entry IDs based on Markdown filenames.
- Later tasks consume `CollectionEntry<"games">` and `CollectionEntry<"categories">`.

- [ ] **Step 1: Write failing schema tests**

Tests must create invalid fixtures or invoke exported validation helpers to prove these fail:

- non-HTTPS embed URL;
- disallowed game Origin;
- empty categories;
- `updatedAt < publishedAt`;
- self-reference in related games;
- SEO title over 65 characters;
- empty image alt.

- [ ] **Step 2: Implement collections**

Use `glob()` loaders and Astro's current `reference()` API.

Required collection names:

```ts
export const collections = {
  games,
  categories,
};
```

The schema must implement every field and constraint from the design spec.

- [ ] **Step 3: Add three real-looking but clearly synthetic sample games**

Requirements:

- three different descriptions;
- two categories;
- one draft game to test filtering;
- absolute `https://play.example.com/.../index.html` embed URLs;
- no copied third-party text;
- locally generated simple SVG/WebP placeholder cover images;
- each body has distinct gameplay content.

- [ ] **Step 4: Verify invalid content fails**

Temporarily add one invalid fixture, run:

```bash
npm run check
```

Expected: FAIL for the intended schema rule.

Remove the invalid fixture and rerun. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content.config.ts src/content src/assets/images/games tests/unit/content-schema.test.ts
git commit -m "feat: define typed game content collections"
```

## Task 5: Implement the content query layer

**Files:**
- Create: `src/lib/content/games.ts`
- Create: `src/lib/content/categories.ts`
- Create: `src/lib/related-games.ts`
- Test: `tests/unit/game-queries.test.ts`
- Test: `tests/unit/related-games.test.ts`

**Interfaces:**
- Produces:
  - `getPublishedGames()`
  - `getFeaturedGames(limit?: number)`
  - `getGameById(id: string)`
  - `getPublishedCategories()`
  - `getCategoryById(id: string)`
  - `getGamesForCategory(categoryId: string)`
  - `rankRelatedGames(game, candidates, limit?)`
- Consumes: Astro collections from Task 4.

- [ ] **Step 1: Write failing query tests**

Test exact deterministic behavior:

- draft entries are excluded;
- published games sort by `publishedAt DESC`, then ID ASC;
- categories sort by `order ASC`, then ID ASC;
- featured limit is respected;
- category filtering returns only matching published games.

- [ ] **Step 2: Implement minimal query functions**

Pages must call these functions rather than directly duplicating filters and sorting.

- [ ] **Step 3: Write failing related-game tests**

Scenarios:

1. explicit references appear first;
2. higher shared-category count wins;
3. shared-tag count breaks ties;
4. newest `publishedAt` breaks the next tie;
5. ID ascending is final deterministic tie-breaker;
6. current game and draft candidates are excluded;
7. result never exceeds 8.

- [ ] **Step 4: Implement `rankRelatedGames`**

Use a pure function. Do not fetch content inside it.

- [ ] **Step 5: Verify**

```bash
npm test -- tests/unit/game-queries.test.ts tests/unit/related-games.test.ts
npm run check
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/content src/lib/related-games.ts tests/unit/game-queries.test.ts tests/unit/related-games.test.ts
git commit -m "feat: add deterministic game content queries"
```

## Task 6: Build static public routes and focused components

**Files:**
- Create: `src/config/site.ts`
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/layout/Header.astro`
- Create: `src/components/layout/Footer.astro`
- Create: `src/components/games/GameCard.astro`
- Create: `src/components/games/GameControls.astro`
- Create: `src/components/games/RelatedGames.astro`
- Create: `src/pages/games/index.astro`
- Create: `src/pages/games/[id].astro`
- Create: `src/pages/category/[id].astro`
- Modify: `src/pages/index.astro`
- Create: `src/pages/about.astro`
- Create: `src/pages/privacy.astro`
- Create: `src/pages/terms.astro`
- Test: `tests/integration/routes.test.ts`

**Interfaces:**
- Consumes query functions from Task 5.
- Produces static routes for every published game and non-empty published category.
- GamePlayer is intentionally a placeholder component until PR 4.

- [ ] **Step 1: Write route generation tests**

After a build, assert:

- published game pages exist;
- the draft game page does not exist;
- both non-empty category pages exist;
- `/games/index.html` exists;
- internal links point to trailing-slash URLs.

- [ ] **Step 2: Implement `BaseLayout`**

Must accept:

```ts
type Props = {
  title: string;
  description: string;
  canonicalPath: string;
  image?: string;
  robots?: string;
};
```

This PR may render basic metadata. Full SEO implementation belongs to PR 3.

- [ ] **Step 3: Implement static pages**

`src/pages/games/[id].astro` and `src/pages/category/[id].astro` must use `getStaticPaths()`.

After the `/games/` route exists, add the 404 recovery link to `/games/`.

Do not:

- call browser fetch;
- use client directives;
- add a server endpoint;
- generate draft routes.

- [ ] **Step 4: Implement original neutral UI**

Requirements:

- mobile-first;
- game cards use 4:3 cover ratio;
- clear focus states;
- semantic headings;
- one H1 per page;
- no competitor copy;
- no final brand artwork;
- no client framework.

- [ ] **Step 5: Verify**

```bash
npm run check
npm run test
npm run build
npm run verify:dist
```

Inspect source:

```bash
grep -R "<h1" dist/games/going-balls/index.html
grep -R "Going Balls" dist/games/going-balls/index.html
```

Expected: content is directly present in built HTML.

- [ ] **Step 6: Commit**

```bash
git add src tests/integration/routes.test.ts
git commit -m "feat: generate game and category pages"
```

## PR 2 Completion Gate

Run the full PR 1 gate plus:

```bash
test -f dist/games/going-balls/index.html
test ! -e dist/games/obstacle-orbit/index.html
test -f dist/category/ball-games/index.html
```

On Windows, use equivalent PowerShell file checks.

Open a Draft PR and stop.

---

# PR 3 — SEO, Structured Data, Sitemap, and Build Verification

**Branch:** `feat/game-seo`  
**PR title:** `feat: add verifiable SEO output`

## Task 7: Add URL and SEO helpers

**Files:**
- Create: `src/lib/urls.ts`
- Create: `src/lib/seo.ts`
- Create: `src/components/seo/JsonLd.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Test: `tests/unit/urls.test.ts`
- Test: `tests/unit/seo.test.ts`

**Interfaces:**
- Produces:
  - `absoluteUrl(path: string): string`
  - `canonicalPath(path: string): string`
  - `buildGameJsonLd(entry, categories): object`
  - `buildBreadcrumbJsonLd(items): object`
  - `buildItemListJsonLd(items): object`
- Consumes `SITE.url` from `src/config/site.ts`.

- [ ] **Step 1: Write failing URL tests**

Cover:

- trailing slash normalization;
- root URL;
- duplicate slash removal;
- rejection of external canonical paths;
- percent-safe path handling.

- [ ] **Step 2: Implement URL helpers**

Do not concatenate URL strings manually outside this module.

- [ ] **Step 3: Write failing JSON-LD tests**

Assert:

- `VideoGame` contains real values only;
- Offer price is `"0"`;
- no aggregateRating when data does not exist;
- breadcrumb positions start at 1;
- URLs are absolute;
- JSON serializes without `undefined`.

- [ ] **Step 4: Implement helpers and component**

`JsonLd.astro` must serialize with `JSON.stringify()`.

- [ ] **Step 5: Expand BaseLayout metadata**

Add:

- canonical;
- Open Graph;
- Twitter Card;
- robots;
- default image fallback;
- exactly one title;
- no LocalBusiness schema.

- [ ] **Step 6: Verify and commit**

```bash
npm test -- tests/unit/urls.test.ts tests/unit/seo.test.ts
git add src/lib src/components/seo src/layouts/BaseLayout.astro tests/unit
git commit -m "feat: add canonical metadata and structured data"
```

## Task 8: Add page-specific structured data and robots

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `src/pages/games/[id].astro`
- Modify: `src/pages/category/[id].astro`
- Create: `src/pages/robots.txt.ts`
- Test: `tests/integration/seo-pages.test.ts`

**Interfaces:**
- Consumes SEO helpers from Task 7.
- Produces `WebSite`, `VideoGame`, `CollectionPage`, `ItemList`, and `BreadcrumbList`.

- [ ] **Step 1: Write failing HTML assertions**

Build HTML and assert exact schema types on each route.

- [ ] **Step 2: Add page schemas**

Do not duplicate helper logic in page files.

- [ ] **Step 3: Add static robots endpoint**

It must output:

```text
User-agent: *
Allow: /
Disallow: /admin/
Sitemap: https://example.com/sitemap-index.xml
```

The URL derives from site config, not a hardcoded production domain.

- [ ] **Step 4: Verify**

```bash
npm run build
npm test -- tests/integration/seo-pages.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/pages tests/integration/seo-pages.test.ts
git commit -m "feat: add page-level SEO schemas and robots"
```

## Task 9: Turn dist verification into a launch-quality gate

**Files:**
- Modify: `scripts/verify-dist.mjs`
- Create: `tests/integration/dist-output.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces a non-zero exit code for any SEO/output violation.
- Consumes built `dist/`.

- [ ] **Step 1: Write failing dist tests**

Test fixtures must prove the verifier rejects:

- duplicate titles;
- missing description;
- missing canonical;
- multiple H1s;
- draft URL in Sitemap;
- `/admin/` in Sitemap;
- internal link target missing;
- JSON-LD parse error;
- canonical without trailing slash.

- [ ] **Step 2: Implement the verifier**

Use Cheerio. Install:

```bash
npm install -D cheerio
```

The verifier must inspect every generated HTML page, not only sample pages.

- [ ] **Step 3: Add page-specific rules**

For `/games/*/`:

- H1 required;
- game body text required;
- category link required;
- `VideoGame` and `BreadcrumbList` required.

For `/category/*/`:

- `CollectionPage`, `ItemList`, and Breadcrumb required.

- [ ] **Step 4: Verify**

```bash
npm run build
npm run verify:dist
npm test
```

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-dist.mjs tests/integration/dist-output.test.ts package.json package-lock.json
git commit -m "test: verify generated SEO output"
```

## PR 3 Completion Gate

In addition to the full gate, attach source excerpts from:

```bash
node -e "console.log(require('fs').readFileSync('dist/games/going-balls/index.html','utf8').slice(0,3000))"
```

The excerpt must show title, description, canonical, H1, body and JSON-LD before any client script runs.

---

# PR 4 — GamePlayer, Iframe Security, and R2 Operations

**Branch:** `feat/game-player-r2`  
**PR title:** `feat: add secure game player and R2 workflow`

## Task 10: Validate game embed URLs

**Files:**
- Create: `src/lib/embed-url.ts`
- Modify: `src/content.config.ts`
- Test: `tests/unit/embed-url.test.ts`

**Interfaces:**
- Produces:
  - `isGameEntryPath(pathname: string): boolean`
  - `parseAllowedGameOrigins(raw: string): URL[]`
  - `validateEmbedUrl(raw: string, allowedOrigins: URL[]): URL`
- Consumes `PUBLIC_GAME_ORIGINS`.

- [ ] **Step 1: Write failing security tests**

Reject:

- `http:`;
- `javascript:`;
- `data:`;
- userinfo;
- fragment;
- unlisted Origin;
- malformed URL;
- path that does not end with the case-sensitive `/index.html` entry filename.

Accept:

- an HTTPS `/index.html` URL whose exact Origin is allowed, with an optional safe query.

- [ ] **Step 2: Implement strict URL validation**

Use the platform `URL` class. Do not use substring matching.

- [ ] **Step 3: Connect validation to content schema**

A bad published `embedUrl` must fail `npm run check` and `npm run build`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/unit/embed-url.test.ts
npm run check
git add src/lib/embed-url.ts src/content.config.ts tests/unit/embed-url.test.ts
git commit -m "feat: validate game embed origins"
```

## Task 11: Implement click-to-load GamePlayer

**Files:**
- Create: `src/components/games/GamePlayer.astro`
- Create: `src/components/games/game-player.ts`
- Modify: `src/pages/games/[id].astro`
- Test: `tests/unit/game-player-dom.test.ts`
- Test: `tests/integration/game-player-html.test.ts`

**Interfaces:**
- Consumes validated `embedUrl`, `title`, `coverImage`, `loadMode`, `aspectRatio`.
- Produces an iframe only after click for `loadMode: "click"`.

- [ ] **Step 1: Write failing initial-HTML test**

For a click-mode game, built HTML must:

- contain Play button;
- contain cover;
- contain embed URL only in a `data-src` attribute;
- not contain an iframe element.

For eager mode:

- iframe may exist at first render.

- [ ] **Step 2: Implement Astro markup**

Use semantic button markup and an aspect-ratio container.

- [ ] **Step 3: Write failing DOM behavior tests**

Test:

- click creates one iframe;
- repeated click does not create duplicates;
- reload replaces the iframe;
- iframe receives exact sandbox and allow attributes;
- keyboard activation works through native button behavior;
- status message updates.

- [ ] **Step 4: Implement minimal client script**

No framework. Keep the script local to the component.

- [ ] **Step 5: Add Fullscreen control**

Use Fullscreen API with error handling. Do not request fullscreen automatically.

- [ ] **Step 6: Verify**

```bash
npm run check
npm run test
npm run build
npm run verify:dist
```

- [ ] **Step 7: Commit**

```bash
git add src/components/games src/pages/games tests
git commit -m "feat: add secure click-to-load game player"
```

## Task 12: Document and validate the R2 release workflow

**Files:**
- Create: `docs/deployment/r2.md`
- Create: `docs/content-authoring.md`
- Create: `scripts/validate-game-package.mjs`
- Test: `tests/unit/validate-game-package.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run game:validate -- <directory>`.
- Does not upload files or require credentials.

- [ ] **Step 1: Write failing package-validator tests**

Reject a directory when:

- `index.html` is missing;
- a file path escapes the package root;
- HTML contains a `<base>` pointing outside the package;
- HTML attempts top-level navigation through obvious `window.top.location` usage;
- package contains `.env`, private keys or source maps by default;
- any single file exceeds the configured 315 MB Wrangler limit when Wrangler mode is selected.

Warn, but do not automatically reject, unknown third-party scripts; include them in the report.

- [ ] **Step 2: Implement the validator**

Output JSON and human-readable summary. Exit non-zero on hard failures.

- [ ] **Step 3: Document R2 setup**

The document must cover:

- bucket creation;
- custom domain;
- disabling production reliance on `r2.dev`;
- rclone/S3 credentials scoped to one bucket;
- upload prefix convention;
- Cache-Control guidance;
- validation before upload;
- rollback;
- verifying `index.html`;
- adding the final URL to game Markdown.

The documented mapping must be exact:

```text
public URL: https://play.example.com/<slug>/index.html
object key: <slug>/index.html
assets: <slug>/assets/<content-hashed-file>
archive: _releases/<slug>/<version>/...
```

Do not assume a `/<slug>/` directory-index mapping and do not add a Worker or
rewrite. Upload immutable hashed assets first, upload `index.html` last with
`no-cache` or a reviewed short cache, and roll back by restoring the same live
`<slug>/index.html` key.

- [ ] **Step 4: Add script**

```json
{
  "scripts": {
    "game:validate": "node scripts/validate-game-package.mjs"
  }
}
```

- [ ] **Step 5: Verify and commit**

```bash
npm test -- tests/unit/validate-game-package.test.ts
npm run game:validate -- tests/fixtures/game-package-valid
git add docs scripts tests package.json package-lock.json
git commit -m "docs: add validated R2 game release workflow"
```

## PR 4 Completion Gate

The PR description must explicitly confirm:

- no game build was added to the main repo;
- no R2 secret exists;
- iframe Origin validation uses exact Origin equality;
- iframe paths use the exact `/index.html` entry contract;
- iframe cannot navigate top-level;
- click-mode HTML remains indexable without loading the game.

---

# PR 5 — Decap CMS and Cloudflare OAuth Proxy

**Branch:** `feat/game-cms`  
**PR title:** `feat: add Git-backed game content administration`

This PR is security-sensitive. Keep the OAuth Worker in a separate commit and separate directory.

## Task 13: Add Decap CMS local authoring

**Files:**
- Create: `public/admin/index.html`
- Create: `public/admin/config.yml`
- Create: `public/admin/preview.css`
- Modify: `package.json`
- Test: `tests/unit/decap-config.test.ts`

**Interfaces:**
- Consumes the exact Games and Categories schemas.
- Produces Markdown files compatible with `src/content.config.ts`.

- [ ] **Step 1: Write failing schema-parity tests**

Parse `public/admin/config.yml` and assert:

- every required game field exists;
- field names exactly match Astro schema names;
- collection folders match;
- status options are `draft` and `published`;
- media paths point to `src/assets/images/games`;
- no original template repository or DecapBridge site ID remains;
- `/admin/` is excluded from indexing.

Install only a small YAML parser:

```bash
npm install -D yaml
```

- [ ] **Step 2: Add pinned CMS client**

Use Decap CMS `3.12.2` in `public/admin/index.html`, not an unbounded `latest` CDN URL.

- [ ] **Step 3: Configure local backend**

Add local authoring support and scripts:

```bash
npm install -D decap-server npm-run-all
```

Scripts:

```json
{
  "scripts": {
    "dev:astro": "astro dev",
    "dev:cms": "decap-server",
    "dev": "run-p dev:astro dev:cms"
  }
}
```

- [ ] **Step 4: Match CMS fields to content schema**

The config must support all required fields in the design spec.

- [ ] **Step 5: Test a local authoring round trip**

Use local CMS or directly write a CMS-shaped Markdown fixture, then run:

```bash
npm run check
npm run build
```

Expected: new content builds without manual correction.

- [ ] **Step 6: Commit**

```bash
git add public/admin package.json package-lock.json tests/unit/decap-config.test.ts
git commit -m "feat: add local Git-backed content editor"
```

## Task 14: Add a separate Cloudflare GitHub OAuth Worker

**Files:**
- Create: `apps/cms-auth/package.json`
- Create: `apps/cms-auth/package-lock.json`
- Create: `apps/cms-auth/wrangler.jsonc`
- Create: `apps/cms-auth/src/index.ts`
- Create: `apps/cms-auth/test/index.test.ts`
- Create: `apps/cms-auth/LICENSES.md`
- Create: `docs/deployment/cms-auth.md`
- Modify: `public/admin/config.yml`

**Interfaces:**
- Produces:
  - `GET /auth`
  - `GET /callback`
- Consumes Cloudflare secrets:
  - `GITHUB_OAUTH_ID`
  - `GITHUB_OAUTH_SECRET`
- Allows only configured `CMS_SITE_ORIGIN`.

- [ ] **Step 1: Select and record the upstream**

Use the maintained MIT-licensed `sterlingwes/decap-proxy` approach as reference. Record:

- upstream repository;
- commit SHA used;
- MIT attribution;
- files adapted;
- security changes.

Do not blindly copy an old Worker.

- [ ] **Step 2: Write failing Worker tests**

Tests must cover:

- `/auth` redirects to GitHub;
- state is cryptographically random;
- callback rejects missing code/state;
- state mismatch fails;
- secret values never appear in response;
- access token never appears in logs;
- postMessage target Origin is exact, not `*`;
- unapproved Origin fails;
- unsupported routes return 404;
- upstream GitHub failures return a controlled error.

- [ ] **Step 3: Implement minimal Worker**

Follow current Cloudflare types and config schema. Generate types using:

```bash
cd apps/cms-auth
npx wrangler types
```

Do not hand-write an `Env` interface when generated types are available.

- [ ] **Step 4: Configure secrets**

Documentation must use:

```bash
npx wrangler secret put GITHUB_OAUTH_ID
npx wrangler secret put GITHUB_OAUTH_SECRET
```

Never store values in `.dev.vars.example`.

- [ ] **Step 5: Configure Decap production backend**

`public/admin/config.yml` must use:

```yaml
backend:
  name: github
  branch: main
  repo: <resolved from current git remote and committed as the real owner/repo>
  base_url: <the actual deployed OAuth Worker URL>
  auth_endpoint: /auth
```

Codex must resolve the real repository from:

```bash
git remote get-url origin
```

Do not leave `owner/repo`, `example`, a previous template repo, or an unrelated Worker URL in the committed file.

If the OAuth Worker is not yet deployed, stop before this step and report the exact missing deployment dependency. Do not commit a fake production URL.

- [ ] **Step 6: Verify**

From root:

```bash
npm run check
npm run test
npm run build
npm run verify:dist
```

From `apps/cms-auth`:

```bash
npm ci
npm run test
npm run check
npx wrangler deploy --dry-run
```

- [ ] **Step 7: Commit**

```bash
git add apps/cms-auth docs/deployment/cms-auth.md public/admin/config.yml
git commit -m "feat: add Cloudflare OAuth proxy for CMS"
```

## PR 5 Completion Gate

Required manual evidence:

- local CMS screenshot;
- GitHub OAuth App callback configuration, with secret hidden;
- Worker dry-run output;
- successful login on preview;
- a test content edit producing a Git commit;
- resulting site build passing;
- no credentials in Git history.

Do not merge on unit tests alone.

---

# PR 6 — Ad Slots, E2E, Accessibility, and Deployment Hardening

**Branch:** `feat/launch-hardening`  
**PR title:** `feat: harden game site for launch`

## Task 15: Add centralized ad slots

**Files:**
- Create: `src/config/ads.ts`
- Create: `src/components/ads/AdSlot.astro`
- Modify: home, game and category pages
- Test: `tests/unit/ads.test.ts`
- Test: `tests/integration/ad-slots.test.ts`

**Interfaces:**
- Produces named slots:
  - `home-after-featured`
  - `game-before-player`
  - `game-after-content`
  - `category-after-grid`
- Default: disabled.

- [ ] **Step 1: Write failing tests**

Assert:

- disabled slots render no wrapper and no layout gap;
- enabled placeholder renders an `Advertisement` label;
- unknown slot ID fails type checking;
- no third-party script is present.

- [ ] **Step 2: Implement minimal slot component**

Do not add an ad vendor.

- [ ] **Step 3: Verify and commit**

```bash
npm test -- tests/unit/ads.test.ts tests/integration/ad-slots.test.ts
git add src tests
git commit -m "feat: add centralized ad slot controls"
```

## Task 16: Add browser and accessibility tests

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/public-pages.spec.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes built preview.
- Produces `npm run test:e2e`.

- [ ] **Step 1: Install test dependencies**

```bash
npm install -D @playwright/test @axe-core/playwright
npx playwright install chromium
```

CI installs Chromium with dependencies.

- [ ] **Step 2: Write failing E2E tests**

Test:

- home → game navigation;
- game page H1 and body visible before Play;
- Play creates iframe;
- reload works;
- category page navigation;
- 404 content;
- keyboard focus;
- zero Axe serious/critical violations on home, one game and one category page.

- [ ] **Step 3: Implement only the fixes required by tests**

Do not use E2E work as a reason for unrelated visual redesign.

- [ ] **Step 4: Add E2E to CI**

Run after build and before Wrangler dry-run.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e package.json package-lock.json .github/workflows/ci.yml
git commit -m "test: add launch browser and accessibility checks"
```

## Task 17: Complete deployment documentation and rollback

**Files:**
- Create: `docs/deployment/workers-static-assets.md`
- Modify: `docs/deployment/r2.md`
- Modify: `docs/review/acceptance-checklist.md`
- Create: `docs/launch-checklist.md`

**Interfaces:**
- Produces a reproducible deployment procedure.
- Does not enable automatic production deployment without approval.

- [ ] **Step 1: Document main-site deployment**

Include:

- environment variables;
- `npm ci`;
- full verification;
- `wrangler deploy --dry-run`;
- `wrangler deploy`;
- custom domain;
- workers.dev noindex verification;
- 404 verification;
- `_headers` verification;
- rollback using Workers versions.

- [ ] **Step 2: Document launch checks**

Include:

- GSC property;
- Sitemap submission;
- URL Inspection of one game page;
- source HTML check;
- robots and canonical;
- R2 custom domain;
- iframe mobile test;
- legal pages;
- ad slot default disabled;
- analytics only after explicit selection;
- backups through Git.

- [ ] **Step 3: Run full release verification**

```bash
npm ci
npm run format:check
npm run check
npm run test
npm run build
npm run verify:dist
npm run test:e2e
npx wrangler deploy --dry-run
git status --short
```

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: add launch and rollback procedures"
```

## PR 6 Completion Gate

Before requesting final review:

- generate a complete requirement matrix mapping every design-spec section to files and tests;
- run all verification commands fresh;
- include screenshots for desktop and mobile;
- include Lighthouse output as diagnostic evidence only, not as a substitute for tests;
- confirm no automatic production deployment was enabled without approval;
- open Draft PR and stop.

---

# Review and Merge Protocol

For every PR:

1. Codex pushes the branch and opens a Draft PR.
2. Codex reports:
   - PR URL;
   - base SHA;
   - head SHA;
   - commit list;
   - changed-file list;
   - exact commands run;
   - pass/fail counts;
   - screenshots when UI changed;
   - deviations.
3. ChatGPT reviews:
   - PR metadata;
   - every changed file;
   - full file context for security/architecture-sensitive files;
   - CI jobs and logs;
   - design-spec coverage;
   - SEO build output;
   - Cloudflare config;
   - secret exposure;
   - test quality.
4. Findings use:
   - **Critical** — security, data loss, indexation failure, architecture violation;
   - **Important** — functional defect, missing test, SEO or accessibility issue;
   - **Minor** — maintainability or polish.
5. Codex fixes Critical and Important findings in the same branch.
6. Codex reruns all relevant verification and pushes.
7. ChatGPT rechecks the new head SHA.
8. Only after ChatGPT explicitly states `本轮验收通过` may the user mark the PR ready and merge.
9. The next branch starts from the newly updated main.

# Final Rule

Codex must execute **PR 1 only** on the first run. It must not continue into PR 2 even when PR 1 passes locally.
