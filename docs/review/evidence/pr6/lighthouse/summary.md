# Project PR 6 Lighthouse diagnostics

Generated on 2026-08-23 with Lighthouse 13.4.1 against the local Wrangler
Static Assets server at `http://127.0.0.1:4323/`. The build uses the committed
placeholder Origins. These results are repository diagnostics, not live-domain
or production-deployment evidence.

## Scores and metrics

| Profile | Performance | Accessibility | Best Practices | SEO |   FCP |   LCP | Speed Index |  TBT | CLS |
| ------- | ----------: | ------------: | -------------: | --: | ----: | ----: | ----------: | ---: | --: |
| Desktop |         100 |           100 |            100 | 100 | 0.2 s | 0.2 s |       0.2 s | 0 ms |   0 |
| Mobile  |         100 |           100 |            100 | 100 | 0.8 s | 0.8 s |       0.8 s | 0 ms |   0 |

Both reports completed with zero run warnings.

## Diagnostic triage

- The first pass exposed an experimental serious
  `label-content-name-mismatch` finding on the site wordmark. The wordmark now
  uses its complete visible text as its natural accessible name, with a static
  HTML regression assertion in `tests/integration/seo-pages.test.ts`. The final
  desktop and mobile audits report this check as `notApplicable` because no
  mismatching element remains.
- The only render-blocking resource is the generated 3,474-byte site stylesheet.
  The mobile diagnostic estimates 50 ms of potential savings; all scored
  performance metrics remain at 100. Inlining or adding a special loading path
  would add complexity and reduce shared-cache value, so no production change
  was justified.
- The network dependency tree consists of the document and that single local
  stylesheet, with no additional preconnect candidate. No action is required.

## Raw reports

- `desktop.report.html`
- `desktop.report.json`
- `mobile.report.html`
- `mobile.report.json`

Lighthouse does not replace the PR's unit, integration, Playwright, Axe,
production-config, Wrangler dry-run, or GitHub Actions evidence.
