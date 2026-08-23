import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const validatorIndex = args.indexOf("--validator");
const validatorValue =
  validatorIndex === -1 ? undefined : args[validatorIndex + 1];

if (!validatorValue) {
  console.error("MISSING_VALIDATOR --validator is required");
  process.exitCode = 1;
} else {
  const validatorPath = resolve(process.cwd(), validatorValue);
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const issueLines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Z0-9_]+\s+[^:]+:/.test(line));
  const actual = issueLines.map((line) =>
    line.match(/^([^\s]+)\s+([^:]+):/)?.slice(1, 3),
  );
  const expected = [
    ["PLACEHOLDER_ORIGIN", "PUBLIC_SITE_ORIGIN"],
    ["PLACEHOLDER_ORIGIN", "CMS_ADMIN_ORIGIN"],
    ["PLACEHOLDER_ORIGIN", "CMS_AUTH_ORIGIN"],
    ["PLACEHOLDER_ORIGIN", "GAME_ORIGIN"],
  ];
  const matchesExpected =
    result.status === 1 &&
    actual.length === expected.length &&
    expected.every(
      ([code, field], index) =>
        actual[index]?.[0] === code && actual[index]?.[1] === field,
    );

  if (!matchesExpected) {
    console.error(output);
    console.error(
      "DEVELOPMENT_PLACEHOLDER_GATE_FAILED expected only four ordered PLACEHOLDER_ORIGIN issues",
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Development placeholder configuration verified: ${validatorPath}`,
    );
  }
}
