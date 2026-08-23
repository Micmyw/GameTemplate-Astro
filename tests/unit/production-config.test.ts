import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Origins = Record<string, string>;
type InvalidCase = {
  name: string;
  expectedCode: string;
  remove?: string;
  set?: Origins;
};
type OriginCases = {
  valid: Origins;
  invalid: InvalidCase[];
};

const projectRoot = resolve(import.meta.dirname, "../..");
const fixturePath = resolve(
  projectRoot,
  "tests/fixtures/production-config/origin-cases.json",
);
const validatorPath = resolve(
  projectRoot,
  "scripts/verify-production-config.mjs",
);

const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as OriginCases;
let runtimeDirectory: string;

beforeAll(async () => {
  runtimeDirectory = await mkdtemp(join(tmpdir(), "game-site-production-"));
});

afterAll(async () => {
  await rm(runtimeDirectory, { force: true, recursive: true });
});

const runValidator = async (name: string, origins: Origins) => {
  const configPath = join(runtimeDirectory, `${name}.json`);
  await writeFile(configPath, `${JSON.stringify(origins, null, 2)}\n`, "utf8");
  return spawnSync(
    process.execPath,
    [validatorPath, "--scope", "origins", "--config", configPath],
    { cwd: projectRoot, encoding: "utf8" },
  );
};

describe("production Origin configuration CLI", () => {
  it("accepts four distinct real-looking HTTPS Origins", async () => {
    const result = await runValidator("valid", cases.valid);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Production Origins verified");
  });

  it.each(
    cases.invalid.map((invalidCase, index) => [index, invalidCase] as const),
  )(
    "rejects invalid Origin fixture %s with its stable issue code",
    async (index, invalidCase) => {
      const origins = { ...cases.valid, ...invalidCase.set };
      if (invalidCase.remove) delete origins[invalidCase.remove];

      const result = await runValidator(`invalid-${index}`, origins);
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status, invalidCase.name).toBe(1);
      expect(output, invalidCase.name).toContain(invalidCase.expectedCode);
    },
  );

  it("keeps the committed placeholder configuration blocked from production", () => {
    const result = spawnSync(process.execPath, [validatorPath], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("PLACEHOLDER_ORIGIN");
  });
});
