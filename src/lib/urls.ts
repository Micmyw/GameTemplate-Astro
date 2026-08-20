import { SITE } from "../config/site";

const LOCAL_PATH_ERROR =
  "SEO URLs must use a local absolute path beginning with one slash";

const stripQueryAndHash = (path: string): string => {
  const queryIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const boundary = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), path.length);

  return path.slice(0, boundary);
};

const isFilePath = (pathname: string): boolean => {
  const finalSegment = pathname.split("/").filter(Boolean).at(-1);
  return finalSegment?.includes(".") ?? false;
};

export const canonicalPath = (path: string): string => {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error(LOCAL_PATH_ERROR);
  }

  const pathname = new URL(stripQueryAndHash(path), SITE.url).pathname.replace(
    /\/{2,}/g,
    "/",
  );

  if (pathname === "/" || isFilePath(pathname)) {
    return pathname;
  }

  return pathname.endsWith("/") ? pathname : `${pathname}/`;
};

export const absoluteUrl = (path: string): string =>
  new URL(canonicalPath(path), SITE.url).toString();
