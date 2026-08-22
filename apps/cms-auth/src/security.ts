export const STATE_COOKIE_NAME = "__Host-decap_oauth_state";
export const STATE_COOKIE_MAX_AGE_SECONDS = 600;
export const TOKEN_EXCHANGE_TIMEOUT_MS = 5_000;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const encoder = new TextEncoder();

export type ConfiguredOrigins = {
  admin: string;
  auth: string;
};

const normalizedHostname = (url: URL): string =>
  url.hostname.replace(/^\[|\]$/g, "");

const parseOrigin = (value: string, label: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute Origin`);
  }

  if (
    value !== url.origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${label} must contain only an absolute Origin`);
  }

  if (url.protocol === "https:") return url;
  if (
    url.protocol === "http:" &&
    LOCAL_HOSTNAMES.has(normalizedHostname(url))
  ) {
    return url;
  }

  throw new Error(`${label} must use HTTPS outside explicit localhost tests`);
};

export const validateConfiguredOrigins = (
  adminOrigin: string,
  authOrigin: string,
): ConfiguredOrigins => {
  const admin = parseOrigin(adminOrigin, "CMS_ADMIN_ORIGIN").origin;
  const auth = parseOrigin(authOrigin, "CMS_AUTH_ORIGIN").origin;

  if (admin === auth) {
    throw new Error(
      "CMS_ADMIN_ORIGIN and CMS_AUTH_ORIGIN must use different Origins",
    );
  }

  return { admin, auth };
};

export const randomHex = (
  byteLength: number,
  cryptoApi: Crypto = crypto,
): string => {
  const bytes = new Uint8Array(byteLength);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

export const constantTimeEqual = async (
  provided: string,
  expected: string,
  cryptoApi: Crypto = crypto,
): Promise<boolean> => {
  const [providedHash, expectedHash] = await Promise.all([
    cryptoApi.subtle.digest("SHA-256", encoder.encode(provided)),
    cryptoApi.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;

  for (let index = 0; index < providedBytes.length; index += 1) {
    difference |= providedBytes[index]! ^ expectedBytes[index]!;
  }

  return difference === 0;
};

export const readCookie = (
  cookieHeader: string | null,
  name: string,
): string | undefined => {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const candidateName = part.slice(0, separator).trim();
    if (candidateName === name) return part.slice(separator + 1).trim();
  }

  return undefined;
};

const stateCookieAttributes = "Path=/; Secure; HttpOnly; SameSite=Lax";

export const createStateCookie = (state: string): string =>
  `${STATE_COOKIE_NAME}=${state}; ${stateCookieAttributes}; Max-Age=${STATE_COOKIE_MAX_AGE_SECONDS}`;

export const clearStateCookie = (): string =>
  `${STATE_COOKIE_NAME}=; ${stateCookieAttributes}; Max-Age=0`;

export const safeScriptJson = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

const COMMON_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export const secureHeaders = (initial?: HeadersInit): Headers => {
  const headers = new Headers(initial);
  for (const [name, value] of Object.entries(COMMON_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
};

export const textResponse = (
  message: string,
  status: number,
  initialHeaders?: HeadersInit,
): Response => {
  const headers = secureHeaders(initialHeaders);
  headers.set("Content-Type", "text/plain; charset=UTF-8");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  return new Response(message, { status, headers });
};
