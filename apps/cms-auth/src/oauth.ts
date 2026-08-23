import { TOKEN_EXCHANGE_TIMEOUT_MS } from "./security";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type AuthorizationOptions = {
  clientId: string;
  redirectUri: string;
  state: string;
};

type TokenOptions = {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetch: FetchLike;
};

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

export const buildAuthorizationUrl = ({
  clientId,
  redirectUri,
  state,
}: AuthorizationOptions): string => {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "public_repo");
  return url.href;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const exchangeCodeForToken = async ({
  clientId,
  clientSecret,
  code,
  redirectUri,
  fetch,
}: TokenOptions): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TOKEN_EXCHANGE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error("GitHub token endpoint rejected request");

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error("GitHub token endpoint returned invalid JSON");
    }

    if (
      !isRecord(value) ||
      typeof value.access_token !== "string" ||
      value.access_token.length === 0
    ) {
      throw new Error("GitHub token endpoint omitted access_token");
    }

    return value.access_token;
  } finally {
    clearTimeout(timeout);
  }
};
