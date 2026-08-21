# Decap CMS OAuth Worker deployment

## PR 5A status

PR 5A delivers reviewed source, automated tests, local Decap authoring, CI, and dry-run evidence only. It does not create a GitHub OAuth App, configure real Cloudflare bindings or Secrets, deploy the Worker, enable remote Admin login, or claim a successful production content commit.

The committed `apps/cms-auth/wrangler.jsonc` values under `.example.test` are non-production placeholders used for type generation and tests. The committed `public/admin/config.yml` intentionally has no `base_url` or `auth_endpoint`, and the Admin shell loads Decap only on loopback hostnames.

## Origin requirements

Choose two exact Origins before PR 5B:

- `<CMS_SITE_ORIGIN>` — the public site Origin that serves `/admin/`;
- `<CMS_AUTH_ORIGIN>` — the dedicated OAuth Worker Origin.

Each value must be an absolute Origin with no path, query, fragment, credentials, or trailing slash. Production values must use HTTPS. HTTP is accepted by the code only for explicit `localhost`, `127.0.0.1`, or `::1` tests. Callback URLs are always constructed from `CMS_AUTH_ORIGIN`; the incoming request Host is never trusted to choose a callback.

## PR 5B manual procedure

Perform these steps only after PR 5A code acceptance:

1. Decide the real `<CMS_SITE_ORIGIN>`.
2. Decide the real `<CMS_AUTH_ORIGIN>`.
3. Create a GitHub OAuth App owned by the appropriate GitHub account or organization.
4. Set its callback URL to exactly `<CMS_AUTH_ORIGIN>/callback`. Do not use a wildcard callback.
5. Replace the two `.example.test` values in `apps/cms-auth/wrangler.jsonc` with the reviewed Origins, then regenerate types:

   ```bash
   cd apps/cms-auth
   npx wrangler types
   ```

6. Configure the GitHub client ID and client Secret as Cloudflare Secrets. Do not place either value in `wrangler.jsonc`, `.dev.vars.example`, source, documentation, CI, or command history:

   ```bash
   npx wrangler secret put GITHUB_OAUTH_ID
   npx wrangler secret put GITHUB_OAUTH_SECRET
   ```

7. Run the complete Worker checks and dry-run:

   ```bash
   npm ci
   npm run format:check
   npm run check
   npm run test
   npx wrangler types
   npx wrangler deploy --dry-run
   ```

8. Review the dry-run bundle and confirm that it contains no real credentials.
9. Deploy the accepted Worker manually:

   ```bash
   npx wrangler deploy
   ```

10. Verify `/auth` redirects to GitHub with the exact callback and `public_repo` scope. Verify `/callback` rejects missing or mismatched state and returns the documented security headers. Do not include code, state, tokens, or Secrets in evidence:

    ```bash
    curl -i -H "Origin: <CMS_SITE_ORIGIN>" <CMS_AUTH_ORIGIN>/auth
    curl -i <CMS_AUTH_ORIGIN>/callback
    ```

11. Add the real Worker Origin to `public/admin/config.yml`:

    ```yaml
    backend:
      name: github
      repo: Micmyw/GameTemplate-Astro
      branch: main
      auth_scope: public_repo
      base_url: <CMS_AUTH_ORIGIN>
      auth_endpoint: /auth
    ```

12. Remove the local-only hostname guard from `public/admin/index.html` only after the real Worker is responding correctly.
13. Open `<CMS_SITE_ORIGIN>/admin/` and complete a real GitHub login.
14. Modify one existing draft content entry without publishing it.
15. Confirm that Decap creates the expected GitHub content commit and that no media is written under `public/`.
16. Confirm the main-site CI, Astro schema check, static build, and draft-route exclusion all pass for that commit.
17. Attach redacted OAuth App callback configuration, real login, content commit, and resulting CI/build evidence to the PR 5B acceptance record.

PR 5B is not complete until all of the above production evidence exists. PR 6 must not begin during either PR 5 checkpoint.
