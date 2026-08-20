import { describe, expect, it } from "vitest";

import { absoluteUrl, canonicalPath } from "../../src/lib/urls";

describe("canonicalPath", () => {
  it.each([
    ["/", "/"],
    ["/games", "/games/"],
    ["/games/", "/games/"],
    ["/games//going-balls///", "/games/going-balls/"],
    ["/games/going-balls/?ref=home#controls", "/games/going-balls/"],
    ["/games/%E2%9C%93/", "/games/%E2%9C%93/"],
    ["/robots.txt", "/robots.txt"],
    ["/404.html", "/404.html"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(canonicalPath(input)).toBe(expected);
  });

  it.each([
    "https://example.com/games/",
    "//example.com/games/",
    "javascript:alert(1)",
    "data:text/html,hello",
    "games/going-balls/",
  ])("rejects non-local canonical input %s", (input) => {
    expect(() => canonicalPath(input)).toThrow(/local absolute path/i);
  });
});

describe("absoluteUrl", () => {
  it("uses the normalized SITE origin for root and page URLs", () => {
    expect(absoluteUrl("/")).toBe("https://example.com/");
    expect(absoluteUrl("/games//going-balls?source=test#play")).toBe(
      "https://example.com/games/going-balls/",
    );
  });

  it("does not double-encode percent-encoded paths", () => {
    expect(absoluteUrl("/games/%E2%9C%93/")).toBe(
      "https://example.com/games/%E2%9C%93/",
    );
  });
});
