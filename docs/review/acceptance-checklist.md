# Pull request acceptance checklist

Use this checklist for every game-site pull request. Mark items that are outside the current PR as `N/A` with a short reason rather than deleting them.

## Scope and architecture

- [ ] The PR implements only its approved section of the implementation plan.
- [ ] Astro build output is confirmed as static; no server bundle or SSR adapter was added.
- [ ] No complete game build was committed to `src/` or `public/`.
- [ ] No credentials, tokens, `.env` files, or other secrets were committed.
- [ ] Any deviation from the design specification is recorded in the PR description.

## Verification evidence

- [ ] Fresh format, type, test, build, dist-verification, and Wrangler results are attached.
- [ ] `npm run test:e2e` passed in desktop and mobile Chromium with the game Origin intercepted by a synthetic response.
- [ ] Homepage, game page, category page, and 404 each have zero Axe `serious` or `critical` violations.
- [ ] The CI run is green and its link is included in the PR description.
- [ ] All three CI jobs remain present: public site, CMS Admin, and CMS OAuth Worker.
- [ ] Playwright reports, traces, and screenshots are uploaded only when the public-site CI job fails.
- [ ] Desktop and mobile screenshots are attached for visible changes.
- [ ] Lighthouse desktop and mobile reports are attached as diagnostics, not used as substitutes for tests.
- [ ] Generated source HTML was inspected, not only the rendered browser page.

## SEO and content

- [ ] Each indexable page has one useful H1 and a unique, non-empty title.
- [ ] Canonical, description, robots, structured data, and Sitemap output match the current PR's requirements.
- [ ] Draft content and all CMS Admin HTML are absent from the public-site output.
- [ ] Core internal links use ordinary anchors and resolve to built routes.

## Game embedding

- [ ] Production iframe URLs use HTTPS and match the exact configured Origin allowlist.
- [ ] The iframe sandbox and permission allowlist match the design specification.
- [ ] SEO-critical copy remains present before a game iframe loads.
- [ ] Play creates one iframe, Reload replaces it, and Fullscreen failure produces a readable status message.
- [ ] Keyboard focus, reduced motion, desktop layout, and mobile layout are covered.

## Advertising boundary

- [ ] The four approved slot IDs are mapped to their specified page boundaries.
- [ ] Default builds contain no ad wrapper, label, reserved layout gap, vendor script, AdSense ID, or test ad ID.
- [ ] Placeholder mode labels each rendered slot `Advertisement`.
- [ ] Unknown slot IDs fail Astro type checking.
- [ ] CMS Admin contains no advertising or public-site analytics.

## Production configuration and deployment

- [ ] `PUBLIC_SITE_NAME` is a real 2–60 character brand, and `PUBLIC_SITE_URL` plus `PUBLIC_GAME_ORIGINS` are present, real, HTTPS-only Origins matching the approved Origin manifest, or production evidence is marked `NOT COMPLETED`.
- [ ] Public, game, CMS Admin, and CMS Auth roles are distinct.
- [ ] The production gate verifies site-name consistency across title/Header/Open Graph/WebSite JSON-LD, canonical, robots, Sitemap exclusions, workers.dev noindex, public-site Decap absence, ad-vendor absence, and disabled ad defaults.
- [ ] `deploy:production:dry` runs format, check, Vitest, production build, dist verification, E2E, the production gate, and Wrangler dry-run without bypasses.
- [ ] `deploy:production` repeats the full gate and Wrangler dry-run before any upload.
- [ ] No automatic production deployment was enabled.
- [ ] The main-site custom domain, live 404, `_headers`, source HTML, canonical, robots, and Sitemap probes are either evidenced or explicitly `NOT COMPLETED`.
- [ ] A prior Workers version and the exact rollback command are recorded before a live deploy.

## CMS, R2, and launch status

- [ ] CMS Admin and Auth remain isolated on dedicated Origins; no token, OAuth code, state, Cookie, or `decap-cms-user` value appears in evidence.
- [ ] Real OAuth login and the post-merge CMS draft-write smoke are either independently evidenced or explicitly `NOT COMPLETED`.
- [ ] `REAL_GAME_PACKAGE_PATH=NONE` is reported as `Real playable game upload: NOT COMPLETED`; no synthetic fixture is presented as a real game.
- [ ] A real R2 release, when present, includes validator output, release manifest, hashes, assets-first upload, no-cache `index.html`, exact-key probe, mobile smoke, and rollback evidence.
- [ ] Legal pages, GSC property, Sitemap submission, URL Inspection, Git backup, and incident contacts are either evidenced or explicitly `NOT COMPLETED`.
- [ ] Every design-spec section has a concrete file/test/CI/evidence/status row in `docs/review/final-requirement-matrix.md`.

## Review record

- CI link:
- Source HTML evidence:
- Screenshot links:
- Lighthouse reports:
- E2E/Axe matrix:
- Production configuration status:
- Main deploy/custom-domain status:
- CMS Admin/Auth live status:
- R2 real game status:
- GSC status:
- Rollback target/result:
- Design-spec deviations: `None`
