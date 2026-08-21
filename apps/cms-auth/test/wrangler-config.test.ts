import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const wranglerConfig = readFileSync(
  new URL("../wrangler.jsonc", import.meta.url),
  "utf8",
);

const objectBody = (property: string): string => {
  const match = wranglerConfig.match(
    new RegExp(`"${property}"\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`),
  );
  if (!match?.[1]) throw new Error(`Missing ${property} configuration`);
  return match[1];
};

describe("Wrangler observability", () => {
  it("does not persist OAuth callback query parameters in automatic telemetry", () => {
    expect(objectBody("logs")).toMatch(/"invocation_logs"\s*:\s*false/);
    expect(objectBody("traces")).toMatch(/"enabled"\s*:\s*false/);
  });
});
