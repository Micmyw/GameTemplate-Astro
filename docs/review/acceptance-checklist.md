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
- [ ] The CI run is green and its link is included in the PR description.
- [ ] Desktop and mobile screenshots are attached for visible changes.
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

## Review record

- CI link:
- Source HTML evidence:
- Screenshot links:
- Design-spec deviations: `None`
