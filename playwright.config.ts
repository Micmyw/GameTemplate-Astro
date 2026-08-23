import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = 4323;
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "output/playwright/test-results",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: [
    [process.env.CI ? "line" : "list"],
    ["html", { open: "never", outputFolder: "output/playwright/report" }],
  ],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-chromium",
      use: devices["Pixel 7"],
    },
  ],
  webServer: {
    command: `npx wrangler dev --local --ip ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
