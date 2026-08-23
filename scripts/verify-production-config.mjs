import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  formatProductionIssues,
  readProductionOrigins,
  validateProductionOrigins,
} from "./production-config.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const scope = valueAfter("--scope") ?? "all";
const projectRoot = resolve(valueAfter("--project-root") ?? ".");
const configPath = resolve(
  valueAfter("--config") ??
    resolve(projectRoot, "config/production-origins.json"),
);

const execFileAsync = promisify(execFile);
const issue = (code, field, message) => ({ code, field, message });

const trackedFiles = async () => {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", projectRoot, "ls-files", "-z"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout.split("\0").filter(Boolean);
};

const isTextSource = (path) =>
  [".astro", ".css", ".html", ".js", ".mjs", ".ts"].includes(
    extname(path).toLowerCase(),
  );

const isSecretConfiguration = (path) =>
  /(?:^|\/)(?:wrangler\.jsonc|config\.ya?ml|[^/]*\.toml|\.env[^/]*)$/i.test(
    path,
  );

const listActualFiles = async (roots) => {
  const files = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      if (entry.isFile()) files.push(path);
    }
  };
  for (const root of roots) await visit(resolve(projectRoot, root));
  return files;
};

const validateRepositoryBoundary = async () => {
  const issues = [];
  const tracked = await trackedFiles();
  const actualFiles = await listActualFiles(["public", "src"]);
  const actualRelativeFiles = actualFiles.map((path) =>
    relative(projectRoot, path).replaceAll("\\", "/"),
  );
  if (actualRelativeFiles.some((path) => path.startsWith("public/admin/"))) {
    issues.push(
      issue(
        "PUBLIC_ADMIN_ROUTE",
        "public/admin",
        "CMS Admin must not be served from the public site",
      ),
    );
  }

  const publicSiteFiles = actualFiles.filter(isTextSource);
  const publicSiteSource = (
    await Promise.all(publicSiteFiles.map((path) => readFile(path, "utf8")))
  )
    .join("\n")
    .toLowerCase()
    .replaceAll(" ", "");
  if (
    publicSiteSource.includes("decap-cms") ||
    publicSiteSource.includes("unpkg.com/decap")
  ) {
    issues.push(
      issue(
        "PUBLIC_DECAP",
        "public/src",
        "Decap must not appear in the public site",
      ),
    );
  }

  if (tracked.some((path) => /(?:^|\/)\.dev\.vars(?:$|\.)/.test(path))) {
    issues.push(
      issue(
        "TRACKED_DEV_VARS",
        ".dev.vars",
        "Development Secret files must not be tracked",
      ),
    );
  }

  const configurationFiles = tracked.filter(isSecretConfiguration);
  const secretAssignment = /["']?GITHUB_OAUTH_(?:ID|SECRET)["']?\s*(?::|=)/;
  for (const path of configurationFiles) {
    const source = await readFile(resolve(projectRoot, path), "utf8");
    if (secretAssignment.test(source)) {
      issues.push(
        issue(
          "TRACKED_SECRET",
          path,
          "OAuth Client ID and Secret must not be assigned in tracked config",
        ),
      );
    }
  }

  return issues;
};

if (scope !== "origins" && scope !== "all") {
  console.error(`UNKNOWN_SCOPE ${scope}`);
  process.exitCode = 1;
} else {
  try {
    const input = await readProductionOrigins(configPath);
    const result = validateProductionOrigins(input);
    const issues = [...result.issues];
    if (scope === "all") {
      issues.push(...(await validateRepositoryBoundary()));
    }
    if (issues.length > 0) {
      console.error(formatProductionIssues(issues));
      process.exitCode = 1;
    } else if (scope === "all") {
      console.log("Repository production configuration verified.");
    } else {
      console.log(`Production Origins verified: ${configPath}`);
    }
  } catch (error) {
    console.error(
      `PRODUCTION_CONFIG_READ_FAILED ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
