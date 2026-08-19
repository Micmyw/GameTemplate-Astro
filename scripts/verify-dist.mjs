import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * @param {string} distDirectory
 */
export async function verifyDist(distDirectory) {
  const indexPath = resolve(distDirectory, "index.html");
  let html;

  try {
    html = await readFile(indexPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("dist/index.html is missing");
    }

    throw error;
  }

  const title = html.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1];
  if (!title?.trim()) {
    throw new Error("dist/index.html must contain a non-empty <title>");
  }

  return { checkedFiles: ["index.html"] };
}

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  verifyDist(resolve("dist"))
    .then(({ checkedFiles }) => {
      console.log(`Verified ${checkedFiles.length} static HTML file.`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
