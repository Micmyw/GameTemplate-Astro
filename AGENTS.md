# Repository guidance

Read the approved design in `docs/superpowers/specs/2026-08-19-seo-game-site-design.md` and the current PR section in `docs/superpowers/plans/2026-08-19-seo-game-site.md` before making changes.

This project uses Node.js 24, npm, Astro's default static output, strict TypeScript, and system fonts. Do not introduce a client framework, server output, a database, or a Cloudflare SSR adapter unless a later approved PR explicitly requires it.

## Delivery rules

- Implement one planned PR only. Do not begin the next PR before the current PR is independently accepted and merged.
- Follow Red → Green → Refactor for new production behavior and keep each task in a focused commit.
- Run every verification command required by the current PR again immediately before claiming success; do not reuse earlier output.
- Never merge the branch. Push it and open a Draft PR for review.
- Stop after reporting the Draft PR URL, base and head SHAs, commits, changed files, fresh verification evidence, deviations, known issues, and required manual configuration.
