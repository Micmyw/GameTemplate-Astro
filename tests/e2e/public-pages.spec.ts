import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const GAME_PATH = "/games/going-balls/";
const CATEGORY_PATH = "/category/ball-games/";
const GAME_ORIGIN_PATTERN = "https://play.example.com/**";

const mockGameOrigin = async (page: Page) => {
  await page.route(GAME_ORIGIN_PATTERN, async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/index.html")) {
      await route.abort("blockedbyclient");
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: { "cache-control": "no-store" },
      body: `<!doctype html><html lang="en"><head><title>Mock game</title></head><body><main>Mock game fixture</main></body></html>`,
    });
  });
};

const openGame = async (page: Page) => {
  await page.goto(GAME_PATH);
  await expect(
    page.getByRole("heading", { level: 1, name: "Going Balls" }),
  ).toBeVisible();
};

const playGame = async (page: Page) => {
  const playButton = page.locator("[data-game-play]");
  await playButton.click();

  const frame = page.locator("[data-game-frame-host] iframe");
  await expect(frame).toHaveCount(1);
  await expect(page.getByText("Game loaded", { exact: true })).toBeVisible();
  await expect(
    page
      .frameLocator("[data-game-frame-host] iframe")
      .getByText("Mock game fixture"),
  ).toBeVisible();

  return { frame, playButton };
};

test.beforeEach(async ({ page }) => {
  await mockGameOrigin(page);
});

test("loads the homepage in the configured desktop or mobile viewport", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Choose the next route, not the next distraction.",
    }),
  ).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (testInfo.project.name === "mobile-chromium") {
    expect(viewport?.width).toBeLessThan(600);
  } else {
    expect(viewport?.width).toBeGreaterThanOrEqual(1200);
  }
});

test("navigates from the homepage to a game using a normal link", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(`a[href="${GAME_PATH}"]`).first().click();

  await expect(page).toHaveURL(new RegExp(`${GAME_PATH}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: "Going Balls" }),
  ).toBeVisible();
});

test("keeps the game heading and guide visible before Play", async ({
  page,
}) => {
  await openGame(page);

  await expect(
    page.getByText("Going Balls is about preserving momentum", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator("[data-game-frame-host] iframe")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Play Going Balls" }),
  ).toBeVisible();
});

test("Play creates exactly one mocked game iframe", async ({ page }) => {
  await openGame(page);
  const { frame, playButton } = await playGame(page);

  await playButton.dispatchEvent("click");
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute(
    "src",
    "https://play.example.com/going-balls/index.html",
  );
});

test("Reload replaces the current iframe without duplicating it", async ({
  page,
}) => {
  await openGame(page);
  const { frame } = await playGame(page);
  await frame.evaluate((element) => {
    element.setAttribute("data-e2e-original-frame", "true");
  });

  await page.getByRole("button", { name: "Reload game" }).click();

  await expect(
    page.locator('iframe[data-e2e-original-frame="true"]'),
  ).toHaveCount(0);
  await expect(frame).toHaveCount(1);
  await expect(page.getByText("Game loaded", { exact: true })).toBeVisible();
});

test("reports a recoverable message when Fullscreen fails", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLIFrameElement.prototype, "requestFullscreen", {
      configurable: true,
      value: () => Promise.reject(new Error("Synthetic fullscreen failure")),
    });
  });
  await openGame(page);
  await playGame(page);

  await page.getByRole("button", { name: "Fullscreen" }).click();

  await expect(
    page.getByText(
      "The game could not enter fullscreen. You can keep playing here.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("navigates from a game to its published category", async ({ page }) => {
  await openGame(page);
  await page.locator(`.game-info-strip a[href="${CATEGORY_PATH}"]`).click();

  await expect(page).toHaveURL(new RegExp(`${CATEGORY_PATH}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: "Ball Games" }),
  ).toBeVisible();
  await expect(page.locator(".game-grid .game-card")).toHaveCount(2);
});

test("serves the custom noindex 404 page", async ({ page }) => {
  const response = await page.goto("/route-that-does-not-exist/");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "That page could not be found.",
    }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, follow",
  );
});

test("keyboard focus reaches and activates the Play control", async ({
  page,
}) => {
  await openGame(page);
  const playButton = page.getByRole("button", { name: "Play Going Balls" });

  for (let press = 0; press < 10; press += 1) {
    await page.keyboard.press("Tab");
    if (
      await playButton.evaluate((button) => button === document.activeElement)
    ) {
      break;
    }
  }

  await expect(playButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-game-frame-host] iframe")).toHaveCount(1);
});

test("honors the reduced-motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const motionStyles = await page.evaluate(() => {
    const cover = document.querySelector(".game-card-cover img");
    if (!cover) throw new Error("Expected a game card cover");

    return {
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      transitionDuration: getComputedStyle(cover).transitionDuration,
    };
  });

  expect(motionStyles).toEqual({
    scrollBehavior: "auto",
    transitionDuration: "0s",
  });
});

const axePages = [
  ["homepage", "/"],
  ["game page", GAME_PATH],
  ["category page", CATEGORY_PATH],
  ["404 page", "/404.html"],
] as const;

for (const [name, path] of axePages) {
  test(`${name} has no serious or critical Axe violations`, async ({
    page,
  }) => {
    await page.goto(path);

    const results = await new AxeBuilder({ page }).analyze();
    const blockingViolations = results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    );

    expect(
      blockingViolations,
      JSON.stringify(blockingViolations, null, 2),
    ).toEqual([]);
  });
}
