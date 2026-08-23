# Decap CMS Admin and OAuth deployment

## PR 5B status

PR 5A has been accepted and merged. PR 5B prepares the production configuration gate, dedicated environments, deployment commands, and live evidence. The repository can temporarily carry the explicit `.placeholder.invalid` values requested for development, but every production verifier rejects those values and every production deploy command runs the verifier before Wrangler.

The top-level `.example.test` values in `apps/cms-auth/wrangler.jsonc` remain test defaults. The separate `production` environment, `apps/cms-admin/public/config.yml`, `apps/cms-admin/public/index.html`, and `config/production-origins.json` must all be replaced with the same approved real Origins before deployment. Until then, `npm run verify:production-config` returns `PLACEHOLDER_ORIGIN`; this is a deliberate production block, not deployment evidence.

## Required Origin topology

Production uses four roles and four independent Origins:

```text
PUBLIC SITE:  https://example.com
CMS ADMIN:    https://cms.example.com
CMS AUTH:     https://cms-auth.example.com
GAME:         https://play.example.com
```

- `<PUBLIC_SITE_ORIGIN>` serves public SEO pages and may later load public-site advertising and analytics.
- `<CMS_ADMIN_ORIGIN>` serves only the Decap CMS static application from `apps/cms-admin`.
- `<CMS_AUTH_ORIGIN>` serves only the OAuth Worker from `apps/cms-auth`.
- The game runtime remains isolated on its own Origin.

`CMS_ADMIN_ORIGIN` and `CMS_AUTH_ORIGIN` must differ. Every configured value must be an absolute Origin with no path, query, fragment, credentials, or trailing slash. Production values must use HTTPS. HTTP is accepted only for explicit `localhost`, `127.0.0.1`, or `::1` tests. Callback URLs are always constructed from `CMS_AUTH_ORIGIN`; the incoming request Host is never trusted to choose a callback.

## Token isolation invariant

Decap 3.15.1 persists authenticated user data, including the GitHub token returned by the backend, in origin-scoped `localStorage`. Browser storage is isolated by Origin, not pathname. Therefore CMS Admin must remain on a dedicated Origin and must never be restored beneath the public site's pathname tree.

The CMS Admin Origin must not load advertising or public-site analytics. Apart from the pinned and integrity-protected Decap client, avoid third-party JavaScript. Do not CNAME the CMS Admin hostname to an environment that injects public-site scripts.

## Local topology

Running `npm run dev` from the repository root starts:

```text
Astro main:         http://127.0.0.1:4321
CMS Admin:          http://127.0.0.1:4322
Decap local backend http://127.0.0.1:8081
```

The Decap server receives `ORIGIN=http://127.0.0.1:4322` because the CMS browser is served by the dedicated Admin application.

## PR 5B manual procedure

Perform these steps only after PR 5A code acceptance:

1. Determine `<PUBLIC_SITE_ORIGIN>`.
2. Determine `<CMS_ADMIN_ORIGIN>`.
3. Determine `<CMS_AUTH_ORIGIN>`.
4. Confirm all three Origins are mutually distinct; the game Origin also remains separate.
5. Create a GitHub OAuth App owned by the appropriate GitHub account or organization.
6. Set its callback URL to exactly `<CMS_AUTH_ORIGIN>/callback`.
7. Confirm that no wildcard callback is configured.
8. Replace the four values in `config/production-origins.json`, then set the same `CMS_ADMIN_ORIGIN` and `CMS_AUTH_ORIGIN` in `apps/cms-auth/wrangler.jsonc` under `env.production`.
9. Configure `GITHUB_OAUTH_ID` as a Cloudflare Secret.
10. Configure `GITHUB_OAUTH_SECRET` as a Cloudflare Secret. Do not place either value in config, source, documentation, CI, a `.dev.vars` file, or command history.
11. Run the complete OAuth Worker checks and dry-run:

    ```bash
    cd apps/cms-auth
    npm ci
    npm run format:check
    npm run check
    npm run test
    npx wrangler types
    npm run verify:production-config
    npx wrangler deploy --dry-run --env production
    ```

12. Deploy the accepted OAuth Worker with `npx wrangler deploy --env production`.
13. Verify `/auth` and `/callback`, including the exact callback, `public_repo` scope, state validation, and security headers. Do not include code, state, tokens, or Secrets in evidence.
14. Replace the placeholder `base_url` with `<CMS_AUTH_ORIGIN>` in `apps/cms-admin/public/config.yml`; keep `auth_endpoint: /auth`.
15. Replace `data-cms-production-hostname` with the exact hostname from `<CMS_ADMIN_ORIGIN>`; keep all three loopback hosts.
16. Confirm the guard uses exact set membership and has no suffix, wildcard, or referrer matching.
17. Run the CMS Admin checks and dry-run:

    ```bash
    cd apps/cms-admin
    npm ci
    npm run format:check
    npm run test:headers
    npm run verify:production-config
    npx wrangler deploy --dry-run --env production
    ```

18. Deploy the accepted CMS Admin Static Assets application with `npx wrangler deploy --env production`.
19. Bind the CMS Admin application to the approved dedicated hostname.
20. Open `<CMS_ADMIN_ORIGIN>/` and complete a real GitHub OAuth login.
21. Verify that the browser's `decap-cms-user` entry exists only in `<CMS_ADMIN_ORIGIN>` localStorage.
22. Open `<PUBLIC_SITE_ORIGIN>` and confirm it cannot access `<CMS_ADMIN_ORIGIN>` localStorage.
23. Before merge, keep the session read-only: do not save content, upload media, publish, or create a CMS commit.
24. Save redacted OAuth App, login, storage-isolation, no-write, and CI evidence in the Draft PR.
25. After independent acceptance and manual merge, edit one harmless line in an existing draft while preserving draft status.
26. Confirm the CMS commit and main CI, and confirm the draft route and Sitemap entry remain absent with no media written to `public/`.
27. Restore the test wording through a second normal commit when required, then log out and confirm the `decap-cms-user` key is gone.

PR 5B is not complete until every production evidence item exists. PR 6 must not begin during either PR 5 checkpoint.
