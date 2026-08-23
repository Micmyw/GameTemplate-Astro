import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const gatePath = resolve(
  projectRoot,
  "scripts/verify-development-placeholder.mjs",
);
let runtimeRoot: string;

beforeAll(async () => {
  runtimeRoot = await mkdtemp(join(tmpdir(), "development-placeholder-gate-"));
});

afterAll(async () => {
  await rm(runtimeRoot, { force: true, recursive: true });
});

const validatorSource = (extraIssue = "") => `
console.error([
  "PLACEHOLDER_ORIGIN PUBLIC_SITE_ORIGIN: blocked",
  "PLACEHOLDER_ORIGIN CMS_ADMIN_ORIGIN: blocked",
  "PLACEHOLDER_ORIGIN CMS_AUTH_ORIGIN: blocked",
  "PLACEHOLDER_ORIGIN GAME_ORIGIN: blocked",
  ${JSON.stringify(extraIssue)},
].filter(Boolean).join("\\n"));
process.exitCode = 1;
`;

const runGate = async (name: string, extraIssue = "") => {
  const validatorPath = join(runtimeRoot, `${name}.mjs`);
  await writeFile(validatorPath, validatorSource(extraIssue), "utf8");
  await chmod(validatorPath, 0o755);

  return spawnSync(process.execPath, [gatePath, "--validator", validatorPath], {
    cwd: projectRoot,
    encoding: "utf8",
  });
};

describe("development placeholder configuration gate", () => {
  it("accepts exactly the four intentional placeholder failures", async () => {
    const result = await runGate("expected-only");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Development placeholder configuration verified",
    );
  });

  it("rejects any deep validation error hidden behind placeholders", async () => {
    const result = await runGate(
      "deep-error",
      "AUTH_INVOCATION_LOGS wrangler: unsafe",
    );
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("AUTH_INVOCATION_LOGS");
  });
});
