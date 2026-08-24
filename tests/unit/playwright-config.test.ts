import { describe, expect, it } from "vitest";

import config from "../../playwright.config";

describe("release E2E configuration", () => {
  it("starts the current local Wrangler Static Assets server without reuse", () => {
    const server = config.webServer;

    expect(server).toBeDefined();
    expect(Array.isArray(server)).toBe(false);
    if (!server || Array.isArray(server)) {
      throw new Error("Expected one Playwright webServer configuration");
    }

    expect(server.command).toMatch(/\bwrangler\s+dev\b/);
    expect(server.url).toBe("http://127.0.0.1:4323");
    expect(server.reuseExistingServer).toBe(false);
    expect(config.use?.baseURL).toBe("http://127.0.0.1:4323");
  });

  it("retains both release browser projects and failure-only diagnostics", () => {
    expect(config.projects?.map((project) => project.name)).toEqual([
      "desktop-chromium",
      "mobile-chromium",
    ]);
    expect(config.use?.screenshot).toBe("only-on-failure");
    expect(config.use?.trace).toBe("retain-on-failure");
  });
});
