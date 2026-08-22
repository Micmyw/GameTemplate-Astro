# Decap CMS Admin and OAuth deployment

## PR 5A status

PR 5A delivers reviewed source, automated tests, three independent CI jobs, local Decap authoring, and dry-run evidence only. It does not create a GitHub OAuth App, configure real Cloudflare bindings or Secrets, deploy either application, enable remote Admin login, or claim a successful production content commit.

The committed `.example.test` values in `apps/cms-auth/wrangler.jsonc` are non-production placeholders used for type generation and tests. The committed `apps/cms-admin/public/config.yml` intentionally has no `base_url` or `auth_endpoint`, and the Admin shell loads Decap only on loopback hostnames.

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

Decap 3.15.1 persists authenticated user data, including the GitHub token returned by the backend, in origin-scoped `localStorage`. Browser storage is isolated by Origin, not pathname. Therefore CMS Admin must remain on a dedicated Origin, and `https://example.com/admin/` is not an acceptable production CMS address.

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
8. Set `CMS_ADMIN_ORIGIN` and `CMS_AUTH_ORIGIN` in `apps/cms-auth/wrangler.jsonc`.
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
    npx wrangler deploy --dry-run
    ```

12. Deploy the accepted OAuth Worker manually.
13. Verify `/auth` and `/callback`, including the exact callback, `public_repo` scope, state validation, and security headers. Do not include code, state, tokens, or Secrets in evidence.
14. Add `base_url: <CMS_AUTH_ORIGIN>` to the backend in `apps/cms-admin/public/config.yml`.
15. Add `auth_endpoint: /auth` beside it.
16. Remove the local-only hostname guard from `apps/cms-admin/public/index.html` only after the real Worker responds correctly.
17. Run the CMS Admin checks and dry-run:

    ```bash
    cd apps/cms-admin
    npm ci
    npm run format:check
    npx wrangler deploy --dry-run
    ```

18. Deploy the accepted CMS Admin Static Assets application.
19. Bind the CMS Admin application to the dedicated `cms.example.com` hostname or its reviewed equivalent.
20. Open `<CMS_ADMIN_ORIGIN>/` and complete a real GitHub OAuth login.
21. Verify that the browser's `decap-cms-user` entry exists only in `<CMS_ADMIN_ORIGIN>` localStorage.
22. Open `<PUBLIC_SITE_ORIGIN>` and confirm it cannot access `<CMS_ADMIN_ORIGIN>` localStorage.
23. Modify one existing draft without publishing it.
24. Confirm Decap creates the expected GitHub content commit and writes media to the repository paths required by Astro.
25. Confirm main-site CI passes for that commit.
26. Confirm the draft route remains absent from the main static build.
27. Save redacted OAuth App, login, storage-isolation, content-commit, and CI evidence.

PR 5B is not complete until every production evidence item exists. PR 6 must not begin during either PR 5 checkpoint.
