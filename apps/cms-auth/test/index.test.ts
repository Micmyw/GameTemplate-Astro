import { load } from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleRequest } from "../src/handler";
import {
  STATE_COOKIE_NAME,
  TOKEN_EXCHANGE_TIMEOUT_MS,
  constantTimeEqual,
  validateConfiguredOrigins,
} from "../src/security";

type TestEnv = Env & {
  GITHUB_OAUTH_ID: string;
  GITHUB_OAUTH_SECRET: string;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const AUTH_ORIGIN = "https://cms-auth.example.test";
const ADMIN_ORIGIN = "https://cms.example.test";
const CODE = "authorization-code-fixture";
const SECRET = "client-secret-fixture";
const TOKEN = "access-token-fixture";

const env = (overrides: Partial<TestEnv> = {}): TestEnv => ({
  CMS_ADMIN_ORIGIN: ADMIN_ORIGIN,
  CMS_AUTH_ORIGIN: AUTH_ORIGIN,
  GITHUB_OAUTH_ID: "client-id-fixture",
  GITHUB_OAUTH_SECRET: SECRET,
  ...overrides,
});

const successFetch =
  (token = TOKEN): FetchLike =>
  async () =>
    Response.json({
      access_token: token,
      token_type: "bearer",
      scope: "public_repo",
    });

const requestAuth = (
  testEnv = env(),
  headers: HeadersInit = { Origin: ADMIN_ORIGIN },
) =>
  handleRequest(new Request(`${AUTH_ORIGIN}/auth`, { headers }), testEnv, {
    fetch: successFetch(),
  });

const cookieValue = (response: Response): string => {
  const setCookie = response.headers.get("set-cookie");
  const value = setCookie?.match(
    new RegExp(`^${STATE_COOKIE_NAME}=([^;]+)`),
  )?.[1];
  if (!value) throw new Error("Missing OAuth state cookie");
  return value;
};

const requestCallback = (
  state: string,
  options: {
    code?: string;
    cookie?: string;
    fetch?: FetchLike;
    query?: URLSearchParams;
    testEnv?: TestEnv;
  } = {},
) => {
  const query =
    options.query ??
    new URLSearchParams({
      code: options.code ?? CODE,
      state,
    });
  return handleRequest(
    new Request(`${AUTH_ORIGIN}/callback?${query}`, {
      headers: {
        Cookie: `${STATE_COOKIE_NAME}=${options.cookie ?? state}`,
      },
    }),
    options.testEnv ?? env(),
    { fetch: options.fetch ?? successFetch() },
  );
};

const expectSecurityHeaders = (response: Response) => {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /auth", () => {
  it("redirects to GitHub with an exact callback and public_repo scope", async () => {
    const response = await requestAuth();
    const location = response.headers.get("location");
    if (!location) throw new Error("Missing redirect location");
    const redirect = new URL(location);

    expect(response.status).toBe(302);
    expect(redirect.origin).toBe("https://github.com");
    expect(redirect.pathname).toBe("/login/oauth/authorize");
    expect(redirect.searchParams.get("client_id")).toBe("client-id-fixture");
    expect(redirect.searchParams.get("redirect_uri")).toBe(
      `${AUTH_ORIGIN}/callback`,
    );
    expect(redirect.searchParams.get("scope")).toBe("public_repo");
    expect(redirect.searchParams.get("state")).toBe(cookieValue(response));
  });

  it("generates a different state with at least 32 random bytes each time", async () => {
    const first = cookieValue(await requestAuth());
    const second = cookieValue(await requestAuth());

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });

  it("sets a short-lived __Host state Cookie with every required attribute", async () => {
    const response = await requestAuth();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(cookie).toMatch(/^__Host-decap_oauth_state=[0-9a-f]{64};/);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
  });

  it("rejects an explicit request Origin outside CMS_ADMIN_ORIGIN", async () => {
    const response = await requestAuth(env(), {
      Origin: "https://attacker.example.test",
    });

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("attacker.example.test");
  });
});

describe("GET /callback validation", () => {
  it("rejects a missing code without echoing state", async () => {
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state, {
      query: new URLSearchParams({ state }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(state);
  });

  it("rejects a missing state without echoing code", async () => {
    const response = await requestCallback("unused", {
      query: new URLSearchParams({ code: CODE }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(CODE);
  });

  it("rejects a missing state Cookie", async () => {
    const state = cookieValue(await requestAuth());
    const response = await handleRequest(
      new Request(`${AUTH_ORIGIN}/callback?code=${CODE}&state=${state}`),
      env(),
      { fetch: successFetch() },
    );

    expect(response.status).toBe(400);
  });

  it("rejects a state mismatch and clears the state Cookie", async () => {
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state, { cookie: `${state}bad` });

    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("compares different-length state values without throwing or succeeding", async () => {
    await expect(
      constantTimeEqual("short", "a much longer value"),
    ).resolves.toBe(false);
  });

  it("handles GitHub authorize errors without exposing their raw values", async () => {
    const state = cookieValue(await requestAuth());
    const query = new URLSearchParams({
      error: "access_denied",
      error_description: "sensitive-upstream-description",
      state,
    });
    const response = await requestCallback(state, { query });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(body).not.toContain("access_denied");
    expect(body).not.toContain("sensitive-upstream-description");
  });

  it("rejects an explicit callback Origin outside CMS_ADMIN_ORIGIN", async () => {
    const state = cookieValue(await requestAuth());
    const query = new URLSearchParams({ code: CODE, state });
    const response = await handleRequest(
      new Request(`${AUTH_ORIGIN}/callback?${query}`, {
        headers: {
          Cookie: `${STATE_COOKIE_NAME}=${state}`,
          Origin: "https://attacker.example.test",
        },
      }),
      env(),
      { fetch: successFetch() },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("attacker.example.test");
  });
});

describe("GitHub token exchange", () => {
  it("sends the exact callback and JSON acceptance contract", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ input, ...(init ? { init } : {}) });
      return Response.json({ access_token: TOKEN });
    };
    const state = cookieValue(await requestAuth());

    const response = await requestCallback(state, { fetch: fetcher });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://github.com/login/oauth/access_token",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("accept")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      client_id: "client-id-fixture",
      client_secret: SECRET,
      code: CODE,
      redirect_uri: `${AUTH_ORIGIN}/callback`,
    });
  });

  it("returns a controlled error for non-2xx token responses", async () => {
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state, {
      fetch: async () => new Response("upstream secret body", { status: 503 }),
    });

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("upstream secret body");
  });

  it("returns a controlled error for invalid JSON", async () => {
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state, {
      fetch: async () =>
        new Response("not-json", {
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("not-json");
  });

  it("returns a controlled error when GitHub omits access_token", async () => {
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state, {
      fetch: async () => Response.json({ scope: "public_repo" }),
    });

    expect(response.status).toBe(502);
  });

  it("never writes token, code, state, or Secret values to logs or errors", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state, {
      fetch: async () => {
        throw new Error(`network ${TOKEN} ${CODE} ${state} ${SECRET}`);
      },
    });
    const body = await response.text();
    const logs = JSON.stringify(error.mock.calls);

    expect(response.status).toBe(502);
    for (const sensitive of [TOKEN, CODE, state, SECRET]) {
      expect(body).not.toContain(sensitive);
      expect(logs).not.toContain(sensitive);
    }
  });

  it("turns an upstream timeout into a controlled error", async () => {
    vi.useFakeTimers();
    const state = cookieValue(await requestAuth());
    let markStarted = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetcher: FetchLike = (_input, init) => {
      markStarted();
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("timed out", "AbortError"));
        });
      });
    };

    const pending = requestCallback(state, { fetch: fetcher });
    await started;
    await vi.advanceTimersByTimeAsync(TOKEN_EXCHANGE_TIMEOUT_MS);
    const response = await pending;

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("timed out");
  });
});

describe("callback HTML", () => {
  it("uses Decap's GitHub messages with the exact Admin Origin and no wildcard", async () => {
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(
      `const targetOrigin = ${JSON.stringify(ADMIN_ORIGIN)}`,
    );
    expect(html).toContain("authorizing:github");
    expect(html).toContain("authorization:github:success:");
    expect(html).toContain("postMessage(authorizingMessage, targetOrigin)");
    expect(html).toContain("postMessage(successMessage, targetOrigin)");
    expect(html).not.toMatch(/postMessage\([^)]*,\s*["']\*["']/);
  });

  it("escapes a token containing a closing script payload", async () => {
    const payload = `token</script><script>globalThis.compromised=true</script>`;
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state, {
      fetch: successFetch(payload),
    });
    const html = await response.text();
    const $ = load(html);

    expect(html).not.toContain(payload);
    expect(html).not.toContain("<script>globalThis.compromised=true</script>");
    expect($("script")).toHaveLength(1);
  });

  it("uses a fresh nonce and strict CSP on every callback", async () => {
    const state = cookieValue(await requestAuth());
    const first = await requestCallback(state);
    const second = await requestCallback(state);
    const firstCsp = first.headers.get("content-security-policy") ?? "";
    const secondCsp = second.headers.get("content-security-policy") ?? "";
    const firstNonce = firstCsp.match(/script-src 'nonce-([^']+)'/)?.[1];
    const secondNonce = secondCsp.match(/script-src 'nonce-([^']+)'/)?.[1];

    expect(firstCsp).toContain("default-src 'none'");
    expect(firstCsp).toContain("frame-ancestors 'none'");
    expect(firstCsp).toContain("base-uri 'none'");
    expect(firstCsp).toContain("form-action 'none'");
    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);
    expect(await first.text()).toContain(`nonce="${firstNonce}"`);
    expect(first.headers.has("cross-origin-opener-policy")).toBe(false);
  });

  it("clears state and applies no-store security headers after success", async () => {
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state);

    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expectSecurityHeaders(response);
  });

  it("does not expose the GitHub client Secret in a successful response", async () => {
    const state = cookieValue(await requestAuth());
    const response = await requestCallback(state);

    expect(await response.text()).not.toContain(SECRET);
  });
});

describe("routing and configuration", () => {
  it("rejects equal CMS Admin and OAuth Worker Origins", () => {
    expect(() => validateConfiguredOrigins(AUTH_ORIGIN, AUTH_ORIGIN)).toThrow(
      /different Origins/i,
    );
  });

  it.each([
    ["CMS_ADMIN_ORIGIN", "https://cms.example.test/path"],
    ["CMS_ADMIN_ORIGIN", "http://cms.example.test"],
    ["CMS_ADMIN_ORIGIN", "https://user:pass@cms.example.test"],
    ["CMS_AUTH_ORIGIN", "https://cms-auth.example.test?query=1"],
    ["CMS_AUTH_ORIGIN", "https://cms-auth.example.test#fragment"],
    ["CMS_AUTH_ORIGIN", "not-an-origin"],
  ] as const)("rejects invalid %s value %s", async (name, value) => {
    const response = await requestAuth(env({ [name]: value }));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(value);
  });

  it("allows explicit localhost HTTP Origins for local tests only", async () => {
    const localEnv = env({
      CMS_ADMIN_ORIGIN: "http://localhost:4322",
      CMS_AUTH_ORIGIN: "http://127.0.0.1:8787",
    });
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/auth", {
        headers: { Origin: "http://localhost:4322" },
      }),
      localEnv,
      { fetch: successFetch() },
    );

    expect(response.status).toBe(302);
  });

  it("rejects a request served from an Origin other than CMS_AUTH_ORIGIN", async () => {
    const response = await handleRequest(
      new Request("https://wrong-auth.example.test/auth", {
        headers: { Origin: ADMIN_ORIGIN },
      }),
      env(),
      { fetch: successFetch() },
    );

    expect(response.status).toBe(403);
  });

  it("returns 404 for unsupported routes", async () => {
    const response = await handleRequest(
      new Request(`${AUTH_ORIGIN}/unsupported`),
      env(),
      { fetch: successFetch() },
    );

    expect(response.status).toBe(404);
  });

  it("returns 405 and Allow for non-GET methods", async () => {
    const response = await handleRequest(
      new Request(`${AUTH_ORIGIN}/auth`, { method: "POST" }),
      env(),
      { fetch: successFetch() },
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expectSecurityHeaders(response);
  });
});
