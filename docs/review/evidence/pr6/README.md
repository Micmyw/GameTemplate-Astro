# Project PR 6 evidence

All evidence in this directory is generated from the local static build using
committed placeholder Origins. It proves repository behavior only; it is not a
production deployment, real R2 game, real OAuth login, or GSC result.

## Screenshots

Generated with `node scripts/capture-pr6-evidence.mjs` against the local
Wrangler Static Assets server. The desktop context uses a 1440 × 900 viewport;
the mobile context uses Playwright's Pixel 7 profile.

- `screenshots/desktop-home.png`
- `screenshots/mobile-home.png`
- `screenshots/desktop-game-before-play.png`
- `screenshots/mobile-game-before-play.png`
- `screenshots/game-iframe-mock-loaded.png` — the iframe response is synthetic
  and no external game request is made.
- `screenshots/category-page.png`
- `screenshots/404-page.png`

Required CMS Admin post-login screenshot: `NOT COMPLETED`. No real GitHub OAuth
login is available in the placeholder-only development phase, and a synthetic
login image must not be presented as production evidence.

## Lighthouse

Desktop and mobile Lighthouse reports in `lighthouse/` use the same local
Wrangler Static Assets server. They are diagnostics only and do not substitute
for unit, integration, E2E, Axe, CI, deployment, or live-service evidence.

- `lighthouse/summary.md` records the four category scores, core metrics, and
  triage decisions.
- `lighthouse/desktop.report.html` and `lighthouse/desktop.report.json` contain
  the raw desktop result.
- `lighthouse/mobile.report.html` and `lighthouse/mobile.report.json` contain
  the raw mobile result.

Both final runs scored 100 for Performance, Accessibility, Best Practices, and
SEO. The first diagnostic pass found a visible-label/accessibility mismatch in
the site wordmark; the code and regression test were corrected before the final
reports were generated.
