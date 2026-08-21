# Third-party reference record

## `sterlingwes/decap-proxy`

- Upstream repository: <https://github.com/sterlingwes/decap-proxy>
- Exact reference commit: `9adde7c898ed4675f414f50334c321d6c87751ed`
- License identified by the approved PR 5 implementation brief: MIT
- Files reviewed as references: `README.md`, `src/index.ts`, `src/oauth.ts`, `test/index.spec.ts`, and `worker-configuration.d.ts`
- Concepts referenced: the two-route GitHub OAuth proxy shape and Decap's `authorizing:github` / `authorization:github:success:<json>` popup message protocol

No upstream source text was copied into this application. The implementation was rewritten around the current project requirements and current Cloudflare types.

### License evidence limitation

The exact upstream commit does not contain a `LICENSE` file or a license field in `package.json`, and GitHub's repository API reports no detected license. It also contains no original copyright notice that can be reproduced here. Accordingly, the task brief's MIT classification is recorded above, but it could not be independently verified from the referenced upstream tree. The repository owner and source author are identified by GitHub as `sterlingwes`; this document does not invent a missing year or copyright statement.

### Security changes in this project

Compared with the reviewed reference, this implementation:

- uses 32 random bytes for OAuth state instead of four;
- stores state in a short-lived `__Host-` Secure, HttpOnly, SameSite=Lax Cookie;
- validates state using fixed-size SHA-256 digests and a constant-work comparison;
- constructs callback URLs only from validated `CMS_AUTH_ORIGIN` configuration;
- restricts popup messages to validated `CMS_SITE_ORIGIN` instead of `*`;
- validates the message sender Origin and opener window;
- escapes `<` in script data and uses a fresh CSP nonce;
- validates both configured Origins and permits HTTP only for explicit loopback tests;
- validates GitHub HTTP status and JSON shape and applies a request timeout;
- clears the state Cookie and returns no-store, no-referrer, nosniff, and frame-denial headers;
- does not log, store, cache, or set a Cookie containing code, state, token, or client Secret values;
- does not add KV, D1, R2, Durable Objects, a database, or a server framework.
