import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  type FetchLike,
} from "./oauth";
import {
  STATE_COOKIE_NAME,
  clearStateCookie,
  constantTimeEqual,
  createStateCookie,
  randomHex,
  readCookie,
  safeScriptJson,
  secureHeaders,
  textResponse,
  validateConfiguredOrigins,
  type ConfiguredOrigins,
} from "./security";

type GitHubSecretBindings = {
  GITHUB_OAUTH_ID: string;
  GITHUB_OAUTH_SECRET: string;
};

export type RuntimeBindings = GitHubSecretBindings & {
  CMS_SITE_ORIGIN: string;
  CMS_AUTH_ORIGIN: string;
};

type HandlerDependencies = {
  fetch?: FetchLike;
  crypto?: Crypto;
};

const callbackUri = (origins: ConfiguredOrigins): string =>
  `${origins.auth}/callback`;

const requestSourceIsAllowed = (
  request: Request,
  siteOrigin: string,
): boolean => {
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === siteOrigin;

  const referer = request.headers.get("Referer");
  if (referer === null) return true;
  try {
    return new URL(referer).origin === siteOrigin;
  } catch {
    return false;
  }
};

const authResponse = (
  request: Request,
  env: RuntimeBindings,
  origins: ConfiguredOrigins,
  cryptoApi: Crypto,
): Response => {
  if (!requestSourceIsAllowed(request, origins.site)) {
    return textResponse("Request Origin is not allowed.", 403);
  }

  const state = randomHex(32, cryptoApi);
  const authorizationUrl = buildAuthorizationUrl({
    clientId: env.GITHUB_OAUTH_ID,
    redirectUri: callbackUri(origins),
    state,
  });
  const headers = secureHeaders({
    Location: authorizationUrl,
    "Set-Cookie": createStateCookie(state),
  });
  return new Response(null, { status: 302, headers });
};

const callbackHtml = (
  token: string,
  siteOrigin: string,
  cryptoApi: Crypto,
): Response => {
  const nonce = randomHex(32, cryptoApi);
  const targetOrigin = safeScriptJson(siteOrigin);
  const authorizingMessage = safeScriptJson("authorizing:github");
  const successMessage = safeScriptJson(
    `authorization:github:success:${JSON.stringify({ token })}`,
  );
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Decap CMS authorization</title>
  </head>
  <body>
    <p id="status" role="status">Completing Decap CMS authorization…</p>
    <script nonce="${nonce}">
      const targetOrigin = ${targetOrigin};
      const authorizingMessage = ${authorizingMessage};
      const successMessage = ${successMessage};
      const receiveMessage = (event) => {
        if (event.origin !== targetOrigin || event.source !== window.opener) return;
        window.opener.postMessage(successMessage, targetOrigin);
        window.removeEventListener("message", receiveMessage, false);
        window.close();
      };

      if (window.opener) {
        window.addEventListener("message", receiveMessage, false);
        window.opener.postMessage(authorizingMessage, targetOrigin);
      } else {
        document.getElementById("status").textContent =
          "The authorization window was not opened by the CMS.";
      }
    </script>
  </body>
</html>`;
  const headers = secureHeaders({
    "Content-Type": "text/html; charset=UTF-8",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    "Set-Cookie": clearStateCookie(),
  });
  return new Response(html, { status: 200, headers });
};

const callbackError = (message: string, clearCookie: boolean): Response =>
  textResponse(
    message,
    400,
    clearCookie ? { "Set-Cookie": clearStateCookie() } : undefined,
  );

const callbackResponse = async (
  request: Request,
  env: RuntimeBindings,
  origins: ConfiguredOrigins,
  dependencies: Required<HandlerDependencies>,
): Promise<Response> => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const storedState = readCookie(
    request.headers.get("Cookie"),
    STATE_COOKIE_NAME,
  );

  if (!state || !storedState) {
    return callbackError(
      "OAuth callback is missing required information.",
      Boolean(storedState),
    );
  }

  if (!(await constantTimeEqual(state, storedState, dependencies.crypto))) {
    return callbackError("OAuth callback state validation failed.", true);
  }

  if (url.searchParams.has("error")) {
    return callbackError("GitHub authorization was not completed.", true);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return callbackError(
      "OAuth callback is missing required information.",
      true,
    );
  }

  let token: string;
  try {
    token = await exchangeCodeForToken({
      clientId: env.GITHUB_OAUTH_ID,
      clientSecret: env.GITHUB_OAUTH_SECRET,
      code,
      redirectUri: callbackUri(origins),
      fetch: dependencies.fetch,
    });
  } catch {
    console.error(
      JSON.stringify({ message: "GitHub OAuth token exchange failed" }),
    );
    return textResponse("GitHub authorization could not be completed.", 502, {
      "Set-Cookie": clearStateCookie(),
    });
  }

  return callbackHtml(token, origins.site, dependencies.crypto);
};

export const handleRequest = async (
  request: Request,
  env: RuntimeBindings,
  providedDependencies: HandlerDependencies = {},
): Promise<Response> => {
  const url = new URL(request.url);
  if (url.pathname !== "/auth" && url.pathname !== "/callback") {
    return textResponse("Not found.", 404);
  }
  if (request.method !== "GET") {
    return textResponse("Method not allowed.", 405, { Allow: "GET" });
  }

  let origins: ConfiguredOrigins;
  try {
    origins = validateConfiguredOrigins(
      env.CMS_SITE_ORIGIN,
      env.CMS_AUTH_ORIGIN,
    );
  } catch {
    return textResponse("CMS authentication configuration is invalid.", 500);
  }

  if (url.origin !== origins.auth) {
    return textResponse("Request Origin is not allowed.", 403);
  }
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin !== null && requestOrigin !== origins.site) {
    return textResponse("Request Origin is not allowed.", 403);
  }

  const dependencies: Required<HandlerDependencies> = {
    fetch: providedDependencies.fetch ?? globalThis.fetch.bind(globalThis),
    crypto: providedDependencies.crypto ?? crypto,
  };

  if (url.pathname === "/auth") {
    return authResponse(request, env, origins, dependencies.crypto);
  }
  return callbackResponse(request, env, origins, dependencies);
};
