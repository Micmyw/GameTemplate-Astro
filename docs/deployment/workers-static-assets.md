# Main-site Workers Static Assets deployment

## Status and boundary

This runbook prepares the public Astro site for a manual Cloudflare Workers
Static Assets release. Repository code, tests, and dry-run capability can be
completed with placeholders. A real custom domain, Cloudflare deployment, DNS
binding, and live probe remain `NOT COMPLETED` until an operator supplies the
approved production Origins and explicitly starts the production phase.

There is no automatic production deployment. Do not add a GitHub Actions deploy
job or treat a successful CI build, Wrangler dry-run, or `workers.dev` preview
as proof that the custom domain is live.

The commands below were checked against the locally pinned Wrangler 4.124.0 CLI
on 2026-08-23. Re-read `npx wrangler <command> --help` before a later production
operation because provider commands can change.

## Architecture invariants

- Astro uses its default static output.
- `wrangler.jsonc` exposes `./dist` through `assets.directory`.
- The main-site config has no `main`, Worker request handler, SSR adapter,
  database, KV, or R2 binding.
- `not_found_handling` is `404-page` and `html_handling` is
  `auto-trailing-slash`.
- CMS Admin and CMS Auth stay on their separate Origins. Decap is never served
  by the public site.
- Game packages stay outside this repository and load only from approved game
  Origins.

## Required non-secret configuration

Replace the four `.placeholder.invalid` values in
`config/production-origins.json` only after the domain topology is approved:

```json
{
  "PUBLIC_SITE_ORIGIN": "https://<PUBLIC_HOST>",
  "CMS_ADMIN_ORIGIN": "https://<CMS_ADMIN_HOST>",
  "CMS_AUTH_ORIGIN": "https://<CMS_AUTH_HOST>",
  "GAME_ORIGIN": "https://<GAME_HOST>"
}
```

Every value must be a distinct HTTPS Origin with no path, query, fragment,
credentials, wildcard, localhost, IP address, or reserved example hostname.

Set the two public build variables in the operator environment, not a committed
`.env` file:

```text
PUBLIC_SITE_URL=https://<PUBLIC_HOST>
PUBLIC_GAME_ORIGINS=https://<GAME_HOST>
```

`PUBLIC_GAME_ORIGINS` may be a comma-separated allowlist when more than one
reviewed game Origin is required. It must include `GAME_ORIGIN`, and none of its
entries may equal the public, Admin, or Auth Origin. Leave `PUBLIC_ADS_MODE`
unset or set it to `disabled`; `placeholder` is a local presentation mode, not
an approved production ad integration.

No OAuth credential or Cloudflare token belongs in these variables. Authenticate
Wrangler through the operator's approved local profile or CI secret store.
Never put a Cloudflare API token in a command argument, Markdown, Git, retained
logs, or a screenshot.

## Pre-deployment gate

Start from the independently accepted and manually merged `main` commit. Fetch
the remote, fast-forward, and confirm a clean worktree before proceeding.

Install exactly the locked dependencies:

```sh
npm ci
```

Run the non-mutating production wrapper:

```sh
npm run deploy:production:dry
```

The wrapper is intentionally exact and cannot skip a failed step. It runs:

1. formatting;
2. Astro and TypeScript checks;
3. all Vitest unit and integration tests;
4. an Astro production-mode build using the operator environment;
5. static output verification;
6. desktop/mobile Playwright and Axe tests using a mocked game Origin;
7. the production configuration gate;
8. `npx wrangler deploy --dry-run`.

The production gate rejects missing or placeholder public variables, Origin
collisions, mismatched built canonical/robots/Sitemap Origins, draft/Admin/404
Sitemap entries, an indexable `workers.dev` preview, public-site Decap, an
advertising vendor, enabled-by-default ad slots, and a shortened deploy script.

During placeholder-only development, use `npm run verify:development-config`.
It proves that the only accepted production-gate failures are the four committed
placeholder Origins while all repository-level checks still run. It is not a
production release approval.

## Manual deployment

Only after the dry wrapper is green and the operator has explicit authorization:

```sh
npm run deploy:production
```

This command repeats the full preflight, performs a second Wrangler dry-run,
and only then uploads the static assets. Record the command time, Git SHA,
Wrangler deployment/version identifier, and prior known-good version. Do not
paste authentication material into the record.

Bind `https://<PUBLIC_HOST>` as the Worker's custom domain in the approved
Cloudflare account and zone. Keep the `workers.dev` address as a preview only.
Do not point the public custom domain at CMS Admin, CMS Auth, or R2.

## Live verification

Probe both response headers and source HTML from the custom domain:

```sh
curl --fail --show-error --head "https://<PUBLIC_HOST>/"
curl --fail --show-error "https://<PUBLIC_HOST>/robots.txt"
curl --fail --show-error "https://<PUBLIC_HOST>/sitemap-index.xml"
curl --fail --show-error "https://<PUBLIC_HOST>/games/<PUBLISHED_SLUG>/"
curl --show-error --head "https://<PUBLIC_HOST>/route-that-does-not-exist/"
```

Confirm all of the following with real responses:

- `/` and a published game return 200;
- an unknown route returns the custom 404 body with HTTP 404;
- source HTML contains the expected H1, copy, canonical, robots metadata, and
  JSON-LD without relying on hydration;
- canonical, Open Graph URL, robots Sitemap, Sitemap index, and child Sitemap
  all use `https://<PUBLIC_HOST>`;
- Sitemap excludes drafts, `/admin/`, and `/404.html`;
- `_headers` produces `nosniff`, the approved referrer policy, permissions
  policy, and clickjacking protection;
- `/_astro/*` responses use the immutable cache policy;
- the `workers.dev` URL sends `X-Robots-Tag: noindex, nofollow` while the custom
  production domain does not receive a site-wide noindex;
- the public site contains no Decap, CMS token storage, ad-vendor script, or
  unapproved analytics.

The committed `_headers` file is a deployment control file, not a public page.
Verify the headers on representative deployed resources instead of claiming
success from the file's source text alone.

## Version rollback

List and inspect recent versions before changing traffic:

```sh
npx wrangler versions list --name game-site --json
npx wrangler versions view <KNOWN_GOOD_VERSION_ID> --name game-site --json
```

Rollback uses the current Wrangler syntax:

```sh
npx wrangler rollback <KNOWN_GOOD_VERSION_ID> \
  --name game-site \
  --message "Rollback after <INCIDENT_ID>"
```

Do not use `--yes` unless the version ID and target name were independently
checked. After rollback, repeat the home, game, 404, headers, canonical, robots,
and Sitemap probes. Record the restored version and result. If the failure was a
bad custom-domain or DNS binding rather than bad assets, restore the prior
binding separately and verify which version the domain actually serves.

## Incident response

- **Wrong Origin or indexation:** remove or restore the bad domain binding,
  confirm `workers.dev` remains noindex, repair the configuration, and rerun the
  entire dry wrapper before redeployment.
- **Broken assets or 404 behavior:** rollback to the recorded version and probe
  exact affected URLs; do not mask the problem with an SSR route.
- **Unexpected Decap, ad, or analytics code:** rollback immediately, preserve
  the failed version for diagnosis, and scan the source and built HTML before a
  reviewed fix.
- **Credential exposure:** stop deployment, revoke or rotate the credential,
  remove unsafe evidence from circulation, and complete an incident review.
- **Bad game package:** follow the independent R2 rollback in `docs/deployment/r2.md`;
  a main-site rollback does not restore R2 objects.

## Required release record

Record the base/head/merge/deployed SHAs, CI URL, exact successful commands,
production Origins with no credentials, deployment and version IDs, custom
domain binding, live probes, source-HTML evidence, screenshot/Lighthouse paths,
known issues, and rollback target. Keep every unavailable live item explicitly
`NOT COMPLETED` rather than substituting fixture or dry-run evidence.
