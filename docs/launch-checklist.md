# Production launch checklist

## Current decision

This checklist separates repository readiness from a real public launch. During
the placeholder-only development phase, use this status:

| Live dependency                                      | Status          |
| ---------------------------------------------------- | --------------- |
| Production domain and four-Origin topology           | `NOT COMPLETED` |
| Main-site Workers deployment and custom domain       | `NOT COMPLETED` |
| CMS Admin/Auth production deployment and OAuth login | `NOT COMPLETED` |
| Post-merge CMS draft-write smoke                     | `NOT COMPLETED` |
| `REAL_GAME_PACKAGE_PATH`                             | `NONE`          |
| Real R2 game upload and gameplay smoke               | `NOT COMPLETED` |
| GSC property, Sitemap submission, and URL Inspection | `NOT COMPLETED` |

The repository may be accepted as launch-hardened while these live items remain
open, but the site must not be described as ready for public players. Do not use
fixture, dry-run, screenshot, or configuration evidence to mark a live item
complete.

## 1. Release identity and Git backup

- [ ] The PR is independently accepted and manually merged with a merge commit.
- [ ] Local `main`, `origin/main`, and the remote repository show the same merge SHA.
- [ ] The three-job main CI run is green.
- [ ] The release SHA, prior known-good SHA, PR URL, CI URL, and operator are recorded.
- [ ] GitHub contains the complete source/content history; no required game build or Secret exists only in an untracked workstation path.
- [ ] A rollback branch or tag is not substituted for the immutable Git commit and Workers/R2 version records.

## 2. Production Origins and Secrets

- [ ] `config/production-origins.json` contains four approved, distinct HTTPS Origins and no placeholder.
- [ ] `PUBLIC_SITE_NAME` is the real 2–60 character public brand, not `GameSite` or another placeholder.
- [ ] `PUBLIC_SITE_URL` exactly equals `PUBLIC_SITE_ORIGIN`.
- [ ] `PUBLIC_GAME_ORIGINS` contains `GAME_ORIGIN` and no public/Admin/Auth Origin.
- [ ] CMS Admin, CMS Auth, public site, and game runtime each serve only their assigned role.
- [ ] No Origin contains a path, query, fragment, credentials, wildcard, localhost, or IP address.
- [ ] Cloudflare and OAuth credentials are in approved secret stores, not Git, chat, command arguments, logs, or screenshots.
- [ ] OAuth Client ID and Client Secret are entered only through interactive Wrangler Secret prompts.

## 3. Repository and deployment gates

- [ ] `npm ci` completed from the release commit.
- [ ] `npm run deploy:production:dry` completed without skipped or masked failures.
- [ ] The production build used the real public environment.
- [ ] Static output verification confirmed canonicals, robots, Sitemap, JSON-LD, links, draft exclusion, Admin exclusion, and GamePlayer security.
- [ ] Header wordmark, titles, `og:site_name`, and homepage `WebSite` JSON-LD all use the exact normalized `PUBLIC_SITE_NAME`.
- [ ] No indexable production HTML title or site-name metadata contains the `GameSite` development fallback.
- [ ] Desktop/mobile Playwright passed with the game iframe request mocked.
- [ ] Axe reported zero `serious` or `critical` violations on home, game, category, and 404 pages.
- [ ] The production configuration gate passed with no placeholder exception.
- [ ] Wrangler dry-run passed with the accepted `wrangler.jsonc`.
- [ ] No automatic production deploy workflow is enabled.

## 4. CMS Admin and Auth prerequisite

- [ ] The dedicated GitHub OAuth App owner, homepage, callback, and editing account are recorded without credentials.
- [ ] CMS Auth is deployed on the exact Auth Origin with both Secrets configured interactively.
- [ ] `/auth` and safe `/callback` failure probes pass without logging code, state, token, Cookie, or credentials.
- [ ] CMS Admin is deployed on its dedicated Origin with noindex, no-store, CSP, clickjacking protection, no ads, and no public analytics.
- [ ] A real OAuth login reads Games and Categories with no console error.
- [ ] Admin storage isolation is proven by key presence/absence only; the `decap-cms-user` value is never captured.
- [ ] The controlled post-merge draft write changed only the intended draft, kept it unpublished, and produced green CI.
- [ ] Logout removes the Admin key, or only that key is removed manually.

If any item in this section remains `NOT COMPLETED`, content editing is not
production-verified even when the public site can be built.

## 5. Main-site Workers release

- [ ] The previous Workers version ID is recorded.
- [ ] `npm run deploy:production` repeated every gate and a Wrangler dry-run before upload.
- [ ] The deployment/version ID and exact release SHA are recorded.
- [ ] The public custom domain is bound to the intended Worker in the intended zone.
- [ ] `/` and one published game route return 200 from the custom domain.
- [ ] An unknown route returns the custom body with HTTP 404.
- [ ] `_headers` policies are present on real responses.
- [ ] `/_astro/*` uses the immutable cache policy.
- [ ] The `workers.dev` preview sends `X-Robots-Tag: noindex, nofollow`.
- [ ] The production custom domain is not globally noindexed.
- [ ] Public source HTML contains the page's H1, body, canonical, robots metadata, and JSON-LD before JavaScript.
- [ ] No public route exposes Decap, Admin HTML, ad-vendor code, OAuth storage, or unapproved analytics.

Follow `docs/deployment/workers-static-assets.md` for commands and rollback.

## 6. R2 game readiness

- [ ] `REAL_GAME_PACKAGE_PATH` points to a licensed package outside the public-site repository, or the status remains `NONE / NOT COMPLETED`.
- [ ] `game:validate` has no errors and every warning has an explicit review outcome.
- [ ] A release manifest records source, license, version, validation, and hashes.
- [ ] Content-hashed immutable assets were uploaded and verified before the entry file.
- [ ] `<slug>/index.html` was uploaded last with `Cache-Control: no-cache` or an approved short policy.
- [ ] The R2 custom domain is active and the public `r2.dev` development URL is disabled.
- [ ] The exact case-sensitive `/slug/index.html` URL works; no directory-index rewrite is assumed.
- [ ] The content `embedUrl` and production allowlist match the exact Origin and entry URL.
- [ ] Desktop and mobile real-game smoke tests cover loading, controls, console, orientation, and iframe layout.
- [ ] A prior entry was restored and verified as a rollback test before re-releasing the accepted entry.

When `REAL_GAME_PACKAGE_PATH=NONE`, do not upload the Playwright mock or any
synthetic HTML as a substitute.

## 7. Public content, legal, ads, and analytics

- [ ] Home, games index, one game, one category, About, Privacy, Terms, and 404 are reviewed on desktop and mobile.
- [ ] Privacy and Terms reflect the actual operators, data handling, game sources, ads, analytics, and contact method before public traffic.
- [ ] Game source and license records are accurate; no synthetic demo is represented as a licensed production game.
- [ ] All four ad slots remain disabled and emit no wrapper or reserved gap.
- [ ] No ad vendor, AdSense ID, test ad ID, pop-up, forced click, redirect, or CMS Admin ad is present.
- [ ] Analytics remains absent until a provider, consent behavior, retention policy, and Privacy disclosure are explicitly approved.
- [ ] Keyboard focus, reduced motion, mobile tap targets, Fullscreen failure, and iframe sizing are manually sampled.

## 8. Search validation

- [ ] A domain-prefix or URL-prefix Google Search Console property is verified for the approved public Origin.
- [ ] `https://<PUBLIC_HOST>/sitemap-index.xml` is submitted once and accepted.
- [ ] URL Inspection is run for the homepage and one published game page.
- [ ] The inspected source HTML shows the intended canonical and indexable content.
- [ ] Live robots does not block public content and references the exact Sitemap Origin.
- [ ] Sitemap contains only canonical, published, indexable public routes.
- [ ] Admin, Auth, game runtime, `workers.dev`, drafts, and 404 are not submitted as public SEO pages.
- [ ] GSC property ID, submission time, inspected URLs, and result are recorded without account credentials.

GSC submission is operational evidence. It does not prove indexing or ranking.

## 9. Visual and diagnostic evidence

- [ ] Desktop homepage screenshot.
- [ ] Mobile homepage screenshot.
- [ ] Desktop game page before Play.
- [ ] Mobile game page before Play.
- [ ] Game page after the mocked iframe loads.
- [ ] Category page screenshot.
- [ ] Custom 404 screenshot.
- [ ] Redacted CMS Admin post-login screenshot, or `NOT COMPLETED` when no real login occurred.
- [ ] Lighthouse desktop JSON/HTML report and score summary.
- [ ] Lighthouse mobile JSON/HTML report and score summary.

Lighthouse is diagnostic only. Fix clear, low-risk defects; do not redesign the
site, introduce SSR, or add complex caching solely to raise a score.

## 10. Incident and rollback readiness

- [ ] An operator and contact channel are assigned for launch monitoring.
- [ ] Workers rollback version, R2 rollback release, and prior domain bindings are recorded.
- [ ] The team knows how to stop traffic without deleting evidence or rewriting Git history.
- [ ] Credential exposure triggers revocation/rotation and incident review, not only file deletion.
- [ ] A bad CMS write is reverted with an audited Git commit and remains draft.
- [ ] A bad game release restores the archived `index.html` and verifies all referenced assets.
- [ ] Post-rollback checks cover source HTML, canonical, robots, Sitemap, headers, 404, iframe loading, and Admin isolation.

## 11. Final go/no-go record

Record each item as `PASS`, `MANUAL`, `BLOCKED`, `NOT APPLICABLE`, or
`NOT COMPLETED`. A public launch is **NO-GO** while any required domain,
deployment, OAuth, playable game, legal, or rollback item is `BLOCKED` or
`NOT COMPLETED`.

```text
Release SHA:
Main CI:
Public Origin:
CMS Admin Origin:
CMS Auth Origin:
Game Origin:
Workers version:
R2 release/version:
GSC property:
Rollback targets:
Known issues:
Decision: GO / NO-GO
Approver and time:
```
