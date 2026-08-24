import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium, devices } from "@playwright/test";

const baseUrl = process.env.EVIDENCE_BASE_URL ?? "http://127.0.0.1:4323";
const outputRoot = resolve("docs/review/evidence/pr6/screenshots");
const gameOrigin = "https://play.example.com";

await mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });

const installNetworkBoundary = async (context) => {
  await context.route("https://**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === gameOrigin && url.pathname.endsWith("/index.html")) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        headers: { "cache-control": "no-store" },
        body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><style>html{height:100%;font:16px system-ui;color:#eef4ff;background:#081126}body{display:grid;height:100%;margin:0;place-items:center}.fixture{padding:2rem;border:1px solid #5d75a8;border-radius:1rem;background:#102044;text-align:center}.fixture strong{display:block;margin-bottom:.5rem;font-size:1.5rem}</style><title>Mock game</title></head><body><main class="fixture"><strong>Mock game fixture</strong><span>No external game network used</span></main></body></html>`,
      });
      return;
    }

    await route.abort("blockedbyclient");
  });
};

const capture = async (page, route, filename, ready) => {
  await page.goto(new URL(route, baseUrl).href, { waitUntil: "networkidle" });
  await ready(page);
  await page.screenshot({
    path: resolve(outputRoot, filename),
    fullPage: true,
  });
};

try {
  const desktop = await browser.newContext({
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await installNetworkBoundary(desktop);
  const desktopPage = await desktop.newPage();

  await capture(desktopPage, "/", "desktop-home.png", (page) =>
    page.getByRole("heading", { level: 1 }).waitFor(),
  );
  await capture(
    desktopPage,
    "/games/going-balls/",
    "desktop-game-before-play.png",
    (page) => page.getByRole("button", { name: "Play Going Balls" }).waitFor(),
  );

  await desktopPage.getByRole("button", { name: "Play Going Balls" }).click();
  await desktopPage
    .frameLocator("[data-game-frame-host] iframe")
    .getByText("Mock game fixture")
    .waitFor();
  await desktopPage.screenshot({
    path: resolve(outputRoot, "game-iframe-mock-loaded.png"),
    fullPage: true,
  });

  await capture(
    desktopPage,
    "/category/ball-games/",
    "category-page.png",
    (page) =>
      page.getByRole("heading", { level: 1, name: "Ball Games" }).waitFor(),
  );
  await capture(
    desktopPage,
    "/route-that-does-not-exist/",
    "404-page.png",
    (page) =>
      page
        .getByRole("heading", {
          level: 1,
          name: "That page could not be found.",
        })
        .waitFor(),
  );
  await desktop.close();

  const mobile = await browser.newContext({
    ...devices["Pixel 7"],
    reducedMotion: "reduce",
  });
  await installNetworkBoundary(mobile);
  const mobilePage = await mobile.newPage();

  await capture(mobilePage, "/", "mobile-home.png", (page) =>
    page.getByRole("heading", { level: 1 }).waitFor(),
  );
  await capture(
    mobilePage,
    "/games/going-balls/",
    "mobile-game-before-play.png",
    (page) => page.getByRole("button", { name: "Play Going Balls" }).waitFor(),
  );
  await mobile.close();
} finally {
  await browser.close();
}

console.log(`PR 6 screenshots written to ${outputRoot}`);
