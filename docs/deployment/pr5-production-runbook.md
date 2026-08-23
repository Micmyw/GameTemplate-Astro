# PR 5 production completion runbook

## Purpose and phase gate

This runbook is the operator checklist for **PR 5B — Production CMS authentication**. It does not authorize production work during PR 5A.

The user has deferred all real domain, deployment, OAuth, Secret, browser-login, CMS-write, and R2 operations during development. The active development boundary and continuation rule are recorded in `docs/superpowers/plans/2026-08-23-development-stage-status.md`. Until production work is explicitly resumed, keep every live item in this runbook as `NOT COMPLETED`, use only the committed placeholders or synthetic test Origins, and do not treat missing production inputs as a reason to stop repository development.

Start this runbook only when all of these conditions are true:

1. PR 5A has an independent `ACCEPTED` review.
2. PR 5A has been merged into `main`.
3. CI for the merge commit on `main` is green.
4. The user has explicitly continued the remaining master plan.
5. Every input in the next section has been supplied or confirmed.
6. The user has chosen a dedicated GitHub editing account, or has explicitly accepted the wider `public_repo` access of the primary account.

If any condition is false, record the live procedure as `NOT COMPLETED` and do not start this production runbook. Continue repository-only development under the committed placeholder gate when the user has authorized that mode; do not deploy either application, create an OAuth App, configure a Secret, or reuse the PR 5A branch.

PR 5B is a project phase name. Its GitHub pull request may be numbered `#6` or higher, but it must not be described as project PR 6. Project PR 6 remains blocked until this Draft PR is independently accepted and manually merged.

## Required production inputs

Record the approved, non-secret values in the operator worksheet. Use actual values for deployment and live evidence. During repository-only preparation, explicit `.placeholder.invalid` values may be present, but the production validators must reject them and no deployment or OAuth-complete claim is permitted.

| Input                  | Requirement                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `<PUBLIC_SITE_ORIGIN>` | Public SEO site Origin                                                                                    |
| `<CMS_ADMIN_ORIGIN>`   | Dedicated CMS Admin Origin                                                                                |
| `<CMS_AUTH_ORIGIN>`    | Dedicated OAuth Worker Origin                                                                             |
| `<GAME_ORIGIN>`        | Dedicated game runtime Origin                                                                             |
| Cloudflare access      | Logged-in operator with permission to deploy both Workers and manage their custom domains and Secrets     |
| GitHub OAuth App owner | Exact user or organization that will own the dedicated App                                                |
| GitHub editing account | Prefer a dedicated account; otherwise document explicit acceptance of primary-account `public_repo` scope |

Each Origin must:

- use HTTPS;
- be an absolute Origin only, with no path, query, fragment, credentials, or wildcard;
- be different from every other Origin;
- resolve to the intended application rather than proxying to another role.

The Admin Origin must serve no advertising or public-site analytics. The public site must not expose Decap CMS. Keep the game runtime on its separate Origin.

## Sensitive-data handling

Never place any of the following in chat, Git, a pull request, CI, command output retained as evidence, screenshots, shell history, `.dev.vars`, or Wrangler configuration:

- GitHub OAuth Client Secret;
- GitHub OAuth authorization code;
- GitHub access token;
- complete OAuth `state` value;
- Cloudflare API Token;
- replayable Cookie values;
- the value of `localStorage["decap-cms-user"]`.

Do not commit the OAuth Client ID either. Enter both OAuth credentials only through interactive Secret commands after checking the currently installed Wrangler command schema:

```bash
cd apps/cms-auth
npx wrangler secret put GITHUB_OAUTH_ID --env production
npx wrangler secret put GITHUB_OAUTH_SECRET --env production
```

Do not pass a Secret on the command line. Keep invocation URL logging and traces disabled because callback URLs can contain OAuth code and state parameters.

## B1. Start from the accepted merge

Fetch and fast-forward the local `main` branch:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short
```

Confirm that the accepted PR 5A merge SHA is an ancestor of both local and remote `main`, that main CI passed for that merge, and that the worktree is clean. Create a new branch:

```bash
git worktree add .worktrees/game-cms-production -b feat/game-cms-production origin/main
```

Do not continue on `feat/game-cms` and do not rewrite PR 5A history.

## B2. Validate the Origin topology

Validate the four approved Origins before editing configuration. Reject HTTP, credentials, trailing paths, queries, fragments, wildcard hosts or callbacks, and any equal pair.

Verify independently that:

- `<CMS_ADMIN_ORIGIN>` serves only CMS Admin;
- `<CMS_AUTH_ORIGIN>` serves only the OAuth Worker;
- `<PUBLIC_SITE_ORIGIN>` does not serve or redirect to CMS Admin;
- `<GAME_ORIGIN>` remains dedicated to reviewed game packages;
- the Admin application cannot be reached through a public-site pathname;
- the Admin hostname does not inject ads, analytics, or public-site scripts.

Stop on any mismatch. DNS convenience is not a reason to collapse Origins.

## B3. Create the dedicated GitHub OAuth App

Create the App under the approved owner and record that owner without recording credentials.

Set:

```text
Homepage URL:              <CMS_ADMIN_ORIGIN>
Authorization callback:   <CMS_AUTH_ORIGIN>/callback
```

The callback must match exactly and must not use a wildcard. Keep the Client ID and Client Secret out of Git and evidence. Prefer authorization with the dedicated editing account. If the primary account will be used, obtain and record explicit acceptance of the expanded `public_repo` access first.

## B4. Configure and validate the production OAuth Worker

Check the current Wrangler v4 configuration and command schemas before changing or executing production commands. Add a formal `production` environment that uses the exact approved values:

```text
CMS_ADMIN_ORIGIN=<CMS_ADMIN_ORIGIN>
CMS_AUTH_ORIGIN=<CMS_AUTH_ORIGIN>
```

Keep the `.example.test` default environment for unit tests. The production environment must not inherit a placeholder. Preserve these controls:

- Admin and Auth Origins are distinct and validated as exact Origins;
- callback URLs are derived only from `CMS_AUTH_ORIGIN`;
- `postMessage` targets only `CMS_ADMIN_ORIGIN`, never `*`;
- OAuth state is cryptographically random and verified through the Secure, HttpOnly, SameSite=Lax host Cookie;
- the state Cookie has `Path=/`, `Max-Age=600`, and no `Domain` attribute;
- token exchange has a timeout;
- errors are controlled and contain no code, state, token, or Secret;
- invocation logs and traces remain disabled.

Configure the two Secrets interactively as described above. Then use the validation-first dry-run wrapper:

```bash
cd apps/cms-auth
npm ci
npm run deploy:production:dry
cd ../..
```

Inspect the dry-run output for the correct environment and bindings without printing values. Stop if the bundle uses `.example.test`, the environment is missing, tests fail, or Wrangler reports an unexpected schema.

## B5. Deploy and probe the OAuth Worker

Only after the production dry-run succeeds:

```bash
cd apps/cms-auth
npm run deploy:production
cd ../..
```

Bind the deployment to `<CMS_AUTH_ORIGIN>`. Record the deployment identifier and the previously active version before changing traffic so rollback remains possible.

Probe `GET <CMS_AUTH_ORIGIN>/auth` with `Origin: <CMS_ADMIN_ORIGIN>` and no redirect following. Verify:

- HTTP 302;
- `Location` points to GitHub;
- the callback is exactly `<CMS_AUTH_ORIGIN>/callback`;
- scope is exactly `public_repo`;
- the state Cookie is Secure, HttpOnly, SameSite=Lax, `Path=/`, `Max-Age=600`, and has no `Domain`;
- cache and content security headers match the accepted Worker contract.

Store only a redacted summary. Do not retain the complete Location query, state, or Cookie.

Probe `GET <CMS_AUTH_ORIGIN>/callback` without code or state. Verify a controlled HTTP 400 with `no-store`, `no-referrer`, `nosniff`, and `X-Frame-Options: DENY`, with no sensitive parameter echoed. Also confirm an unapproved request Origin is rejected.

## B6. Configure CMS Admin production authentication

Update `apps/cms-admin/public/config.yml` without changing the repository, branch, collections, or media paths:

```yaml
backend:
  name: github
  repo: Micmyw/GameTemplate-Astro
  branch: main
  auth_scope: public_repo
  base_url: <CMS_AUTH_ORIGIN>
  auth_endpoint: /auth
```

Use the real exact Auth Origin during PR 5B, not the placeholder shown here. Keep `local_backend` for local authoring. Do not add a wildcard, Secret, OAuth code, token, or fake production URL.

## B7. Enable the accepted Admin hostname

Update `apps/cms-admin/public/index.html` so the approved `<CMS_ADMIN_ORIGIN>` loads the CMS client. Loopback hosts (`localhost`, `127.0.0.1`, and `::1`) must continue to support the local backend.

Preserve:

- Decap CMS version `3.15.1`;
- the accepted SRI hash and `crossorigin="anonymous"`;
- the dedicated-Origin security comment;
- the local favicon;
- `apps/cms-admin/public/_headers`;
- no ads or analytics.

Do not use `latest`, remove SRI, or add a broad hostname fallback.

## B8. Add a production configuration gate

Add and run a `verify:production-config` command before either production deployment. It must reject:

- `.example.test` in production configuration;
- missing `base_url` or missing `/auth` `auth_endpoint`;
- an HTTP or malformed Origin;
- equal Admin and Auth Origins;
- an Admin or Auth Origin equal to the public-site Origin;
- a wildcard callback;
- a hostname guard that still blocks the approved Admin hostname;
- Decap returning to public-site `public/` or `src/`;
- ads or analytics on CMS Admin;
- missing `_headers`, noindex, no-store, or clickjacking protection.

The production deploy workflow must run this gate first. Tests must keep using non-production fixtures and must not need real credentials.

## B9. Validate and deploy CMS Admin

Run the validation-first production dry-run wrapper:

```bash
cd apps/cms-admin
npm ci
npm run deploy:production:dry
```

Only after every command succeeds:

```bash
npm run deploy:production
cd ../..
```

Bind the accepted deployment to `<CMS_ADMIN_ORIGIN>` and record the prior and new deployment identifiers. From the real Origin, request `/`, `/config.yml`, `/preview.css`, and `/favicon.svg`. Each must return the accepted noindex, no-store, nosniff, referrer, frame, permissions, and CSP headers. `/_headers` must not return the configuration file as a public asset.

Confirm the Admin page has no ad, analytics, wildcard CORS, `unsafe-inline`, `unsafe-eval`, or `Cross-Origin-Opener-Policy: same-origin` response policy.

## B10. Perform the real OAuth login and isolation checks

Open `<CMS_ADMIN_ORIGIN>` in a clean browser profile and complete GitHub authorization with the approved editing account. Verify:

- the popup starts at the exact Auth Origin and reaches the exact callback;
- login completes without a console error;
- Games and Categories collections can be read;
- image previews and relation fields work;
- no wildcard `postMessage` is used;
- no token appears in the URL, console, network logs retained as evidence, Worker logs, or screenshots.

At the Admin Origin, record only that the `decap-cms-user` key exists. Never record its value. At the public-site Origin, confirm the Admin Origin's storage cannot be read and that no equivalent `decap-cms-user` data is present. Origin isolation must be demonstrated by browser behavior, not inferred from unit tests.

## B11. Keep pre-merge access read-only

Before the PR 5B configuration is independently accepted and merged, use CMS only to log in and read Games and Categories. Do not save, publish, upload media, or create a content commit on `main`.

Create a Draft PR titled `feat: configure production CMS authentication`. Include redacted Origin, dry-run, deployment, header, login, storage-isolation, scan, and CI evidence plus an explicit statement that no production content was written.

## B12. Accept and merge PR 5B

Keep the PR Draft until independent review accepts the code. Critical and Important findings must be fixed and reverified in the same PR. In a live-production phase, merge only after the production evidence and a fresh green three-job CI run are both accepted. In the user-approved placeholder-only development phase, the repository PR may merge after the code, placeholder deep gates, independent review, and three-job CI pass while all live evidence remains explicitly `NOT COMPLETED`; repository-only PR 6 work may then continue without claiming PR 5B production completion.

Record the PR URL, base SHA, head SHA, merge SHA, changed files, commits, all checks, deployment identifiers, and redacted production evidence. A dry-run does not replace deployment evidence, and deployment does not replace login evidence.

## B13. Run one post-merge CMS write smoke test

After the PR 5B merge and green `main` CI, use the existing `obstacle-orbit` draft when it still satisfies the preconditions. Make one minimal, harmless text change while preserving `status: draft`.

Do not change the real game URL, publish the draft, or upload unlicensed media. Verify that:

- Decap creates exactly the expected GitHub commit;
- only the target draft changes;
- `main` CI passes;
- Astro content/schema checks pass;
- no route is emitted for the draft;
- the Sitemap excludes the draft;
- no media is written into `public/`.

After capturing redacted evidence, either restore the test text through CMS in a second controlled commit or retain a clearly identified backend-validation note. Never rewrite shared history to remove the smoke-test commit.

## B14. Log out and clean browser storage

Log out through CMS and verify that the `decap-cms-user` key is absent. If logout does not clear it, remove only that key from the CMS Admin Origin's localStorage. Do not clear unrelated storage on the public-site Origin. Evidence records key presence or absence only, never its value.

## Failure handling and rollback

Stop at the first failed gate. Do not continue in the hope that a later deployment or login will repair an earlier mismatch.

- **Invalid or collapsed Origin:** remove traffic from the incorrect binding, restore the prior DNS/custom-domain mapping, and repeat Origin validation before any OAuth work.
- **OAuth callback or scope mismatch:** do not authorize. Correct the App and Worker configuration, rerun tests and dry-run, and redeploy before retrying.
- **Worker deployment or probe failure:** restore the previously recorded Worker version or detach the new custom-domain binding. Confirm `/auth` is no longer routed to the failed version before retrying.
- **Admin deployment or header failure:** restore the previous Static Assets deployment or detach the new Admin binding. Do not leave an indexable or frameable Admin page online.
- **Secret, code, token, state, or Cookie exposure:** stop immediately. Revoke the OAuth grant, rotate the affected OAuth credential, invalidate exposed sessions, remove unsafe evidence from circulation, and complete an incident review before resuming. Do not rely on deleting a Git commit that already exposed a credential.
- **Unexpected pre-merge content write:** stop editing and revert the exact content commit with a normal audited revert. Keep the content as draft and rerun CI; do not force-push `main`.
- **Post-merge smoke-test failure:** restore only the target draft through a follow-up commit, preserve failure evidence, and fix the code in a separately reviewed change.
- **Failed login cleanup:** revoke the test account's OAuth authorization if necessary, remove only CMS Admin storage, and verify no token was logged.

After rollback, verify the active custom-domain targets, response headers, Git state, and absence of task-owned local listeners. Record the rollback identifier and outcome without sensitive values.

## Required evidence and final report

The PR 5B report must distinguish `COMPLETED` from `NOT COMPLETED` for every item:

- phase name and PR URL;
- base, head, and merge SHAs;
- focused commits and changed files;
- four-Origin topology and validation results;
- OAuth App owner and exact callback, with credentials hidden;
- Worker production dry-run, deployment, `/auth`, and `/callback` results;
- CMS Admin production dry-run, deployment, real response headers, and private `/_headers` result;
- real OAuth login, collection reads, preview/relation checks, and console result;
- Admin/public-site localStorage isolation, recording key state only;
- pre-merge no-write declaration;
- post-merge draft commit and exact changed file;
- merged-main CI and draft route/Sitemap/media results;
- repository scans for Secrets, tokens, `.dev.vars`, placeholder production Origins, wildcard CORS/postMessage, unsafe CSP, strong COOP, ads, analytics, and public-site Decap;
- logout and storage cleanup;
- known issues, deviations, rollback actions, and final worktree state.

Never mark PR 5 complete from unit tests, dry-runs, screenshots of configuration, or deployment alone. Real deployment, real login, storage isolation, controlled post-merge draft write, and resulting green `main` CI are all required.
