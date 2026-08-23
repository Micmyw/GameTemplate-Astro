import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";

const HOST = "127.0.0.1";
const PORT = 4322;
const BASE_URL = `http://${HOST}:${PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const OUTPUT_LIMIT = 16_000;
const packageRoot = resolve(import.meta.dirname, "..");
const wranglerEntry = resolve(
  packageRoot,
  "node_modules/wrangler/bin/wrangler.js",
);

const expectedHeaders = new Map([
  ["x-robots-tag", "noindex, nofollow"],
  ["cache-control", "no-store"],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["x-frame-options", "DENY"],
  [
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  ],
]);
const requiredCspDirectives = [
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
];
const popupIsolationHeader = ["cross", "origin", "opener", "policy"].join("-");
const forbiddenCspTokens = [
  ["unsafe", "inline"].join("-"),
  ["unsafe", "eval"].join("-"),
];

const delay = (milliseconds) =>
  new Promise((complete) => setTimeout(complete, milliseconds));

const isPortListening = () =>
  new Promise((complete) => {
    const socket = createConnection({ host: HOST, port: PORT });
    let settled = false;

    const finish = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      complete(listening);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });

const hasExited = (child) =>
  child.exitCode !== null || child.signalCode !== null;

const waitForExit = (child, timeoutMs) =>
  new Promise((complete) => {
    if (hasExited(child)) {
      complete(true);
      return;
    }

    let timer;
    const onExit = () => {
      clearTimeout(timer);
      complete(true);
    };

    child.once("exit", onExit);
    timer = setTimeout(() => {
      child.off("exit", onExit);
      complete(false);
    }, timeoutMs);
  });

const runTaskkill = (pid) =>
  new Promise((complete, reject) => {
    const taskkill = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });

    taskkill.once("error", reject);
    taskkill.once("exit", (code) => complete(code));
  });

const terminateProcessTree = async (child) => {
  if (!child || hasExited(child)) return;

  if (process.platform === "win32") {
    const code = await runTaskkill(child.pid);
    if (code !== 0 && !hasExited(child)) {
      throw new Error(`taskkill failed for Wrangler PID ${child.pid}`);
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  if (await waitForExit(child, SHUTDOWN_TIMEOUT_MS)) return;

  if (process.platform === "win32") {
    await runTaskkill(child.pid);
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  if (!(await waitForExit(child, SHUTDOWN_TIMEOUT_MS))) {
    throw new Error(`Wrangler PID ${child.pid} did not exit`);
  }
};

const waitForPortToClose = async () => {
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (!(await isPortListening())) {
      await delay(200);
      if (!(await isPortListening())) return;
    }
    await delay(100);
  }

  throw new Error(`${HOST}:${PORT} still has a listener after cleanup`);
};

const request = async (pathname) => {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(2_000),
  });
  const body = await response.text();

  return { body, headers: response.headers, status: response.status };
};

const waitForReady = async (child, getOutput) => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (hasExited(child)) {
      throw new Error(`Wrangler exited before readiness.\n${getOutput()}`);
    }

    try {
      const response = await request("/");
      if (response.status === 200) return;
    } catch {
      // Wrangler is still starting.
    }

    await delay(200);
  }

  throw new Error(`Wrangler did not become ready.\n${getOutput()}`);
};

const verifyAsset = async (pathname) => {
  const response = await request(pathname);

  if (response.status !== 200) {
    throw new Error(`${pathname} returned HTTP ${response.status}`);
  }

  for (const [name, expected] of expectedHeaders) {
    const actual = response.headers.get(name);
    if (actual !== expected) {
      throw new Error(
        `${pathname} returned ${name}: ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`,
      );
    }
  }

  const csp = response.headers.get("content-security-policy");
  for (const directive of requiredCspDirectives) {
    if (!csp?.includes(directive)) {
      throw new Error(
        `${pathname} is missing CSP directive ${JSON.stringify(directive)}`,
      );
    }
  }

  if (response.headers.get("access-control-allow-origin") === "*") {
    throw new Error(`${pathname} returned wildcard CORS`);
  }
  if (response.headers.get(popupIsolationHeader) === "same-origin") {
    throw new Error(`${pathname} returned popup-breaking same-origin COOP`);
  }
  if (forbiddenCspTokens.some((token) => csp?.includes(token))) {
    throw new Error(`${pathname} returned an unsafe CSP relaxation`);
  }
};

const verifyHeadersFileIsPrivate = async () => {
  const response = await request("/_headers");

  if (response.status !== 404) {
    throw new Error(`/_headers returned HTTP ${response.status}; expected 404`);
  }
  if (response.body.includes("X-Robots-Tag: noindex, nofollow")) {
    throw new Error("/_headers exposed the static configuration file body");
  }
};

let wrangler;
let output = "";
let failure;

try {
  if (!existsSync(wranglerEntry)) {
    throw new Error("Package-local Wrangler is missing; run npm ci first");
  }
  if (await isPortListening()) {
    throw new Error(`${HOST}:${PORT} is already in use; refusing to start`);
  }

  wrangler = spawn(
    process.execPath,
    [wranglerEntry, "dev", "--ip", HOST, "--port", String(PORT)],
    {
      cwd: packageRoot,
      detached: process.platform !== "win32",
      env: { ...process.env, NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const collectOutput = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-OUTPUT_LIMIT);
  };
  wrangler.stdout.on("data", collectOutput);
  wrangler.stderr.on("data", collectOutput);

  await new Promise((complete, reject) => {
    wrangler.once("spawn", complete);
    wrangler.once("error", reject);
  });

  await waitForReady(wrangler, () => output);
  for (const pathname of ["/", "/config.yml", "/preview.css"]) {
    await verifyAsset(pathname);
  }
  await verifyHeadersFileIsPrivate();
} catch (error) {
  failure = error;
} finally {
  try {
    await terminateProcessTree(wrangler);
    await waitForPortToClose();
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError([failure, cleanupError], "Test and cleanup failed")
      : cleanupError;
  }
}

if (failure) {
  console.error(failure);
  process.exitCode = 1;
} else {
  console.log(
    "Verified CMS Admin security headers on /, /config.yml, and /preview.css.",
  );
  console.log("Verified /_headers returns 404 and is not publicly served.");
  console.log(`Verified Wrangler stopped and ${HOST}:${PORT} is closed.`);
}
