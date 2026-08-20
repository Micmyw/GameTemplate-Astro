import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * @param {string} distDirectory
 * @param {string} file
 */
async function readBuiltHtml(distDirectory, file) {
  const filePath = resolve(distDirectory, file);

  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`dist/${file} is missing`);
    }

    throw error;
  }
}

/**
 * @param {string} html
 * @param {string} file
 */
function readTitle(html, file) {
  const title = html.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1];
  if (!title?.trim()) {
    throw new Error(`dist/${file} must contain a non-empty <title>`);
  }

  return title.trim();
}

/**
 * @param {string} distDirectory
 */
export async function verifyDist(distDirectory) {
  const indexHtml = await readBuiltHtml(distDirectory, "index.html");
  const indexTitle = readTitle(indexHtml, "index.html");
  const notFoundHtml = await readBuiltHtml(distDirectory, "404.html");
  const notFoundTitle = readTitle(notFoundHtml, "404.html");

  if (!/\bnoindex\b/i.test(notFoundHtml)) {
    throw new Error("dist/404.html must contain noindex");
  }

  if (indexTitle === notFoundTitle) {
    throw new Error(
      "dist/404.html must use a title distinct from dist/index.html",
    );
  }

  return { checkedFiles: ["index.html", "404.html"] };
}

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  verifyDist(resolve("dist"))
    .then(({ checkedFiles }) => {
      console.log(`Verified ${checkedFiles.length} static HTML files.`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
