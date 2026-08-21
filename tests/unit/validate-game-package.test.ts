import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatHumanReport,
  validateGamePackage,
} from "../../scripts/validate-game-package.mjs";

const fixturesRoot = resolve(import.meta.dirname, "../fixtures/game-packages");
const validatorScript = resolve(
  import.meta.dirname,
  "../../scripts/validate-game-package.mjs",
);
const runtimeDirectories: string[] = [];

type RuntimeFiles = Record<string, string | Uint8Array>;

const fixture = (name: string) => join(fixturesRoot, name);
const issueCodes = (issues: readonly { code: string }[]) =>
  issues.map(({ code }) => code);

async function createRuntimePackage(files: RuntimeFiles) {
  const directory = await mkdtemp(join(fixturesRoot, ".runtime-"));
  runtimeDirectories.push(directory);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const file = join(directory, relativePath);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contents);
    }),
  );

  return directory;
}

afterEach(async () => {
  while (runtimeDirectories.length > 0) {
    const directory = runtimeDirectories.pop();
    if (directory) await rm(directory, { force: true, recursive: true });
  }
});

describe("validateGamePackage", () => {
  it("accepts a self-contained package and reports its inventory", async () => {
    const report = await validateGamePackage(fixture("valid"));

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.summary).toMatchObject({
      entry: "index.html",
      fileCount: 6,
    });
    expect(report.summary.totalBytes).toBeGreaterThan(0);
  });

  it("rejects a directory that does not exist", async () => {
    const report = await validateGamePackage(fixture("does-not-exist"));

    expect(issueCodes(report.errors)).toContain("DIRECTORY_MISSING");
  });

  it("requires index.html to exist as a regular file", async () => {
    const missing = await validateGamePackage(fixture("missing-index"));
    const directory = await validateGamePackage(fixture("index-directory"));

    expect(issueCodes(missing.errors)).toContain("ENTRY_MISSING");
    expect(issueCodes(directory.errors)).toContain("ENTRY_NOT_FILE");
  });

  it("rejects symlinks and reports a realpath that escapes the package", async () => {
    const outside = await mkdtemp(join(fixturesRoot, ".outside-"));
    runtimeDirectories.push(outside);
    await writeFile(join(outside, "outside.js"), "console.log('outside');");

    const directory = await createRuntimePackage({
      "index.html": "<!doctype html><title>Fixture</title>",
    });
    await symlink(outside, join(directory, "linked-assets"), "junction");

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toEqual(
      expect.arrayContaining(["SYMLINK_NOT_ALLOWED", "REALPATH_ESCAPE"]),
    );
  });

  it("rejects files with multiple hard links", async () => {
    const directory = await createRuntimePackage({
      "assets/original.js": "console.log('fixture');",
      "index.html": '<!doctype html><script src="assets/original.js"></script>',
    });
    await link(
      join(directory, "assets/original.js"),
      join(directory, "assets/hard-linked.js"),
    );

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("HARD_LINK_NOT_ALLOWED");
  });

  it.each([
    ["path-escape", "RESOURCE_PATH_ESCAPE"],
    ["encoded-path-escape", "RESOURCE_PATH_ESCAPE"],
    ["css-path-escape", "RESOURCE_PATH_ESCAPE"],
    ["css-image-set-path-escape", "RESOURCE_PATH_ESCAPE"],
    ["css-webkit-image-set-missing", "RESOURCE_MISSING"],
    ["css-image-function-missing", "RESOURCE_MISSING"],
    ["html-imagesrcset-path-escape", "RESOURCE_PATH_ESCAPE"],
    ["svg-xlink-path-escape", "RESOURCE_PATH_ESCAPE"],
    ["svg-xlink-missing", "RESOURCE_MISSING"],
    ["root-resource", "RESOURCE_PATH_ESCAPE"],
    ["missing-resource", "RESOURCE_MISSING"],
  ])("rejects unsafe or broken local resources in %s", async (name, code) => {
    const report = await validateGamePackage(fixture(name));

    expect(issueCodes(report.errors)).toContain(code);
  });

  it("decodes CSS escapes before checking resource paths", async () => {
    const directory = await createRuntimePackage({
      "index.html": '<!doctype html><link rel="stylesheet" href="styles.css">',
      "styles.css": String.raw`body { background: u\72l("\2e\2e/outside.png"); }`,
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("RESOURCE_PATH_ESCAPE");
  });

  it("decodes CSS escapes and ignores comments in image-set string URLs", async () => {
    const directory = await createRuntimePackage({
      "index.html": '<!doctype html><link rel="stylesheet" href="styles.css">',
      "styles.css": String.raw`.hero { background-image: i\6d age-set(/* gap */ "\2e\2e/outside.png" 1x); }`,
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("RESOURCE_PATH_ESCAPE");
  });

  it("removes CSS string line continuations before checking an image URL", async () => {
    const directory = await createRuntimePackage({
      "index.html": '<!doctype html><link rel="stylesheet" href="styles.css">',
      "outside.png": "decoy inside the package",
      "styles.css": `.hero { background-image: image-set(".\\
./outside.png" 1x); }`,
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("RESOURCE_PATH_ESCAPE");
  });

  it("does not treat an image-set type hint as a resource URL", async () => {
    const directory = await createRuntimePackage({
      "assets/game.png": "synthetic image bytes",
      "index.html": '<!doctype html><link rel="stylesheet" href="styles.css">',
      "styles.css":
        '.hero { background-image: image-set("assets/game.png" 1x type("image/png")); }',
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it.each([
    'image-set("https://cdn.example.test/game.png" 1x)',
    '-webkit-image-set("https://cdn.example.test/game.png" 1x)',
    'image("https://cdn.example.test/game.png")',
  ])("warns about an external CSS image function URL: %s", async (value) => {
    const directory = await createRuntimePackage({
      "index.html": '<!doctype html><link rel="stylesheet" href="styles.css">',
      "styles.css": `.hero { background-image: ${value}; }`,
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(issueCodes(report.warnings)).toContain("EXTERNAL_NETWORK");
  });

  it("reports an invalid escaped CSS resource without crashing", async () => {
    const directory = await createRuntimePackage({
      "index.html": '<!doctype html><link rel="stylesheet" href="styles.css">',
      "styles.css": String.raw`body { background: url("\ffffff.png"); }`,
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(false);
    expect(issueCodes(report.errors)).toContain("RESOURCE_MISSING");
  });

  it.each(["external-base", "root-base"])(
    "rejects an external or root-relative base URL in %s",
    async (name) => {
      const report = await validateGamePackage(fixture(name));

      expect(issueCodes(report.errors)).toContain("BASE_URL_NOT_ALLOWED");
    },
  );

  it("rejects javascript resource URLs in HTML and CSS", async () => {
    const html = await validateGamePackage(fixture("javascript-url"));
    const css = await validateGamePackage(fixture("javascript-css-url"));

    expect(issueCodes(html.errors)).toContain("JAVASCRIPT_URL");
    expect(issueCodes(css.errors)).toContain("JAVASCRIPT_URL");
  });

  it.each([
    "data:text/javascript,window.top.location='/escape'",
    "blob:https://package.invalid/synthetic-script",
  ])("rejects an inline or blob script source: %s", async (source) => {
    const directory = await createRuntimePackage({
      "index.html": `<!doctype html><script src="${source}"></script>`,
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SCRIPT_URL_NOT_ALLOWED");
  });

  it.each([
    ["href", "data:text/javascript,globalThis.fixture=1"],
    ["xlink:href", "blob:https://package.invalid/synthetic-svg-script"],
  ])(
    "rejects an executable SVG script URL in %s",
    async (attribute, source) => {
      const directory = await createRuntimePackage({
        "index.html": `<!doctype html><svg><script ${attribute}="${source}"></script></svg>`,
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).toContain("SCRIPT_URL_NOT_ALLOWED");
    },
  );

  it("continues allowing an inline image data URL", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><img alt="Fixture" src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==">',
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("rejects a javascript scheme split by browser-normalized whitespace", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><iframe src="java&#10;script:document.body.dataset.pwned=1"></iframe>',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("JAVASCRIPT_URL");
  });

  it("checks every srcset candidate after an inline data URL", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><img alt="Fixture" srcset="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA== 1x, ../outside.png 2x">',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("RESOURCE_PATH_ESCAPE");
  });

  it("allows a fragment-only SVG xlink:href", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><svg xmlns:xlink="http://www.w3.org/1999/xlink"><symbol id="icon"></symbol><use xlink:href="#icon" /></svg>',
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("checks href and xlink:href independently on the same SVG element", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><svg xmlns:xlink="http://www.w3.org/1999/xlink"><image href="../outside.png" xlink:href="#safe" /></svg>',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("RESOURCE_PATH_ESCAPE");
  });

  it("allows an image preload with imagesrcset and no href", async () => {
    const directory = await createRuntimePackage({
      "assets/game-1x.png": "synthetic 1x image bytes",
      "assets/game-2x.png": "synthetic 2x image bytes",
      "index.html":
        '<!doctype html><link rel="preload" as="image" imagesrcset="assets/game-1x.png 1x, assets/game-2x.png 2x" />',
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it.each([
    "window.top.location = 'https://escape.example/'",
    "top.location.replace('https://escape.example/')",
    "parent.location = 'https://escape.example/'",
    "(window.top).location = 'https://escape.example/'",
    "(0, window.top).location = 'https://escape.example/'",
    "((window.top)).location = 'https://escape.example/'",
    "(void 0, window.top).location = 'https://escape.example/'",
    "(getTarget(), window.top).location = 'https://escape.example/'",
    "const value = `${(window.top.location = '/escape')}`",
    "top['location'] = '/escape'",
    "window.top['location'] = '/escape'",
    'window[/* gap */ "top"][/* gap */ "location"] = "/escape"',
    "window /* comment */ . top /* comment */ . location = '/escape'",
  ])("rejects obvious top-level navigation: %s", async (source) => {
    const directory = await createRuntimePackage({
      "index.html": `<!doctype html><script>${source}</script>`,
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("TOP_NAVIGATION");
  });

  it("rejects target=_top case-insensitively", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><form action="next.html" target=" _TOP "></form>',
      "next.html": "<!doctype html><title>Next</title>",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("TOP_NAVIGATION");
  });

  it("rejects the committed top-navigation fixture used by the completion gate", async () => {
    const report = await validateGamePackage(fixture("top-navigation"));

    expect(issueCodes(report.errors)).toContain("TOP_NAVIGATION");
  });

  it("rejects Service Worker registration", async () => {
    const report = await validateGamePackage(fixture("service-worker"));

    expect(issueCodes(report.errors)).toContain("SERVICE_WORKER");
  });

  it("rejects bracket-notation Service Worker registration", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><script>navigator.serviceWorker["register"]("service-worker.js")</script>',
      "service-worker.js": "self.addEventListener('fetch', () => undefined);",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SERVICE_WORKER");
  });

  it("rejects bracket-notation Service Worker registration with token gaps", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><script>navigator[/* gap */ "serviceWorker"][/* gap */ "register"]("service-worker.js")</script>',
      "service-worker.js": "self.addEventListener('fetch', () => undefined);",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SERVICE_WORKER");
  });

  it("rejects Service Worker registration with comments between tokens", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><script>navigator /* comment */ . serviceWorker /* comment */ . register("service-worker.js")</script>',
      "service-worker.js": "self.addEventListener('fetch', () => undefined);",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SERVICE_WORKER");
  });

  it("rejects optional-chained Service Worker registration", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><script>navigator.serviceWorker?.register("service-worker.js")</script>',
      "service-worker.js": "self.addEventListener('fetch', () => undefined);",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SERVICE_WORKER");
  });

  it("rejects parenthesized Service Worker registration", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><script>(navigator.serviceWorker).register("service-worker.js")</script>',
      "service-worker.js": "self.addEventListener('fetch', () => undefined);",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SERVICE_WORKER");
  });

  it.each([
    "(navigator.serviceWorker.register)('service-worker.js')",
    "navigator.serviceWorker.register.call(navigator.serviceWorker, 'service-worker.js')",
    "navigator.serviceWorker.register?.('service-worker.js')",
  ])(
    "rejects an indirect Service Worker registration call: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "index.html": `<!doctype html><script>${source}</script>`,
        "service-worker.js": "self.addEventListener('fetch', () => undefined);",
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).toContain("SERVICE_WORKER");
    },
  );

  it.each([
    "// window.top.location = '/not-code'",
    "/* window.top.location = '/not-code' */",
    "const example = \"window.top.location = '/not-code'\"",
    `const example = 'window.top.location = "/not-code"'`,
    "const example = `window.top.location = '/not-code'`",
  ])(
    "does not reject navigation text that is not executable: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "index.html": `<!doctype html><script>${source}</script>`,
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).not.toContain("TOP_NAVIGATION");
    },
  );

  it("does not reject navigation text inside a regular-expression literal", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        "<!doctype html><script>const pattern = /window.top.location/;</script>",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).not.toContain("TOP_NAVIGATION");
  });

  it.each(['/["]/;', "/[']/;", "/[`]/;"])(
    "continues scanning after a quoted character in a regex literal: %s",
    async (pattern) => {
      const directory = await createRuntimePackage({
        "index.html": `<!doctype html><script>${pattern} window.top.location = "/escape";</script>`,
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).toContain("TOP_NAVIGATION");
    },
  );

  it.each(["if (ready) /window.top.location/.test(value)"])(
    "does not reject a regex after a control condition: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "index.html": `<!doctype html><script>${source}</script>`,
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).not.toContain("TOP_NAVIGATION");
    },
  );

  it.each([
    "function fixture() {} /window.top.location/.test(value)",
    "class Fixture {} /window.top.location/.test(value)",
  ])(
    "does not reject a regex after a declaration block: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "index.html": `<!doctype html><script>${source}</script>`,
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).not.toContain("TOP_NAVIGATION");
    },
  );

  it("does not reject a regex after an anonymous default-export function", async () => {
    const directory = await createRuntimePackage({
      "game.mjs":
        "export default function() {} /window.top.location/.test(value)",
      "index.html":
        '<!doctype html><script type="module" src="game.mjs"></script>',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).not.toContain("TOP_NAVIGATION");
  });

  it("does not reject a regex after an anonymous default-export generator", async () => {
    const directory = await createRuntimePackage({
      "game.mjs":
        "export default function*() {} /window.top.location/.test(value)",
      "index.html":
        '<!doctype html><script type="module" src="game.mjs"></script>',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).not.toContain("TOP_NAVIGATION");
  });

  it.each([
    'if (ready) /["]/; window.top.location = "/escape"',
    'if (ready) {} /["]/; window.top.location = "/escape"',
    'function fixture() {} /["]/; window.top.location = "/escape"',
    'class Fixture {} /["]/; window.top.location = "/escape"',
  ])(
    "continues scanning after a regex in statement context: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "index.html": `<!doctype html><script>${source}</script>`,
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).toContain("TOP_NAVIGATION");
    },
  );

  it("continues after a regex following an anonymous default-export function", async () => {
    const directory = await createRuntimePackage({
      "game.mjs":
        'export default function() {} /["]/; window.top.location = "/escape"',
      "index.html":
        '<!doctype html><script type="module" src="game.mjs"></script>',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("TOP_NAVIGATION");
  });

  it("continues after a regex following an anonymous default-export generator", async () => {
    const directory = await createRuntimePackage({
      "game.mjs":
        'export default function*() {} /["]/; window.top.location = "/escape"',
      "index.html":
        '<!doctype html><script type="module" src="game.mjs"></script>',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("TOP_NAVIGATION");
  });

  it("does not reject navigation text inside an HTML-style script comment", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        "<!doctype html><script><!-- window.top.location = '/not-code' --></script>",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).not.toContain("TOP_NAVIGATION");
  });

  it.each([
    [
      'const endpoint = "https://example.test/"; window /* gap */ . top /* gap */ . location = "/escape"',
      "TOP_NAVIGATION",
    ],
    [
      'const endpoint = "https://example.test/"; navigator /* gap */ . serviceWorker /* gap */ . register("service-worker.js")',
      "SERVICE_WORKER",
    ],
  ])(
    "does not let a URL string hide a later hard failure: %s",
    async (source, code) => {
      const directory = await createRuntimePackage({
        "index.html": `<!doctype html><script>${source}</script>`,
        "service-worker.js": "self.addEventListener('fetch', () => undefined);",
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).toContain(code);
    },
  );

  it("rejects source maps by default", async () => {
    const report = await validateGamePackage(fixture("source-map"));

    expect(issueCodes(report.errors)).toContain("SOURCE_MAP");
  });

  it("rejects an inline source map", async () => {
    const directory = await createRuntimePackage({
      "game.js":
        "console.log('fixture');\n//# sourceMappingURL=data:application/json;base64,e30=",
      "index.html": '<!doctype html><script src="game.js"></script>',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SOURCE_MAP");
  });

  it("rejects .env, .dev.vars, .git, and node_modules anywhere in a package", async () => {
    const directory = await createRuntimePackage({
      ".dev.vars.local": "TOKEN=fixture-only",
      ".env.production": "TOKEN=fixture-only",
      ".git/config": "[core]",
      "index.html": "<!doctype html><title>Fixture</title>",
      "node_modules/example/index.js": "export {};",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toEqual(
      expect.arrayContaining(["FORBIDDEN_DIRECTORY", "SECRET_FILE"]),
    );
    expect(
      issueCodes(report.errors).filter((code) => code === "SECRET_FILE"),
    ).toHaveLength(2);
  });

  it("rejects PEM/private/SSH key filenames and content without echoing it", async () => {
    const fakeSecret = "DO_NOT_LEAK_FIXTURE_PRIVATE_MATERIAL";
    const directory = await createRuntimePackage({
      "assets/config.txt": `-----BEGIN OPENSSH PRIVATE KEY-----\n${fakeSecret}`,
      "assets/private-key.pem": "fixture certificate container",
      "index.html": "<!doctype html><title>Fixture</title>",
    });

    const report = await validateGamePackage(directory);
    const serialized = `${JSON.stringify(report)}\n${formatHumanReport(report)}`;

    expect(issueCodes(report.errors)).toEqual(
      expect.arrayContaining(["SECRET_CONTENT", "SECRET_FILE"]),
    );
    expect(serialized).not.toContain(fakeSecret);
  });

  it("scans the entire file for private material instead of only its prefix", async () => {
    const directory = await createRuntimePackage({
      "assets/late-secret.txt": `${"x".repeat(1024 * 1024 + 32)}\n-----BEGIN PRIVATE KEY-----`,
      "index.html": "<!doctype html><title>Fixture</title>",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SECRET_CONTENT");
  });

  it("detects private material encoded as UTF-16LE", async () => {
    const fakeSecret = "DO_NOT_LEAK_UTF16_FIXTURE";
    const directory = await createRuntimePackage({
      "assets/config.bin": Buffer.from(
        `-----BEGIN PRIVATE KEY-----\n${fakeSecret}`,
        "utf16le",
      ),
      "index.html": "<!doctype html><title>Fixture</title>",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SECRET_CONTENT");
    expect(JSON.stringify(report)).not.toContain(fakeSecret);
  });

  it("rejects PHP, CGI, and Python server-side programs", async () => {
    const directory = await createRuntimePackage({
      "cgi/launch.cgi": "#!/usr/bin/env perl",
      "index.html": "<!doctype html><title>Fixture</title>",
      "server/handler.php": "<?php echo 'no';",
      "tools/build.py": "print('no')",
    });

    const report = await validateGamePackage(directory);

    expect(
      issueCodes(report.errors).filter((code) => code === "SERVER_FILE"),
    ).toHaveLength(3);
  });

  it("rejects an extensionless Python CGI entrypoint", async () => {
    const directory = await createRuntimePackage({
      "cgi-bin/run": "#!/usr/bin/env python3\nprint('no')",
      "index.html": "<!doctype html><title>Fixture</title>",
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SERVER_CONTENT");
  });

  it("rejects a file above a caller-provided maximum without a large fixture", async () => {
    const report = await validateGamePackage(fixture("valid"), {
      maxFileBytes: 8,
    });

    expect(issueCodes(report.errors)).toContain("FILE_TOO_LARGE");
  });

  it("does not load or parse a file after it exceeds the configured maximum", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        "<!doctype html><script>window.top.location = '/would-run-only-if-parsed'</script>",
    });

    const report = await validateGamePackage(directory, { maxFileBytes: 8 });

    expect(issueCodes(report.errors)).toContain("FILE_TOO_LARGE");
    expect(issueCodes(report.errors)).not.toContain("TOP_NAVIGATION");
  });

  it("emits separate warnings without failing the package", async () => {
    const report = await validateGamePackage(fixture("warnings-only"), {
      largeAssetWarningBytes: 8,
    });

    expect(report.ok).toBe(true);
    expect(issueCodes(report.warnings)).toEqual(
      expect.arrayContaining([
        "DYNAMIC_RESOURCE",
        "EXTERNAL_FORM",
        "EXTERNAL_NETWORK",
        "EXTERNAL_SCRIPT",
        "UNHASHED_LARGE_ASSET",
        "WINDOW_OPEN",
      ]),
    );
  });

  it.each([
    ['fetch("//tracker.example/collect")', "EXTERNAL_NETWORK"],
    ['fetch(" https://tracker.example/collect")', "EXTERNAL_NETWORK"],
    ['fetch("ht" + "tps://tracker.example/collect")', "DYNAMIC_RESOURCE"],
    [
      'fetch("ht" /* assembled at runtime */ + "tps://tracker.example/collect")',
      "DYNAMIC_RESOURCE",
    ],
    ["fetch(`/assets/${name}.json`)", "DYNAMIC_RESOURCE"],
    ["fetch /* runtime URL */ (runtimeAssetUrl)", "DYNAMIC_RESOURCE"],
    ["asset.setAttribute('src', runtimeAssetUrl)", "DYNAMIC_RESOURCE"],
    ["asset['src'] = runtimeAssetUrl", "DYNAMIC_RESOURCE"],
    [
      'navigator.sendBeacon("//tracker.example/collect", "fixture")',
      "EXTERNAL_NETWORK",
    ],
    ['new WebSocket("wss://socket.example")', "EXTERNAL_NETWORK"],
    ['window /* comment */ . open("//tracker.example")', "WINDOW_OPEN"],
    ['window["open"]("help.html")', "WINDOW_OPEN"],
  ])("warns for reviewable client behavior: %s", async (source, code) => {
    const directory = await createRuntimePackage({
      "index.html": '<!doctype html><script src="game.js"></script>',
      "game.js": source,
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(issueCodes(report.warnings)).toContain(code);
  });

  it.each([
    'import("data:text/javascript,globalThis.fixture=1")',
    'import("blob:https://package.invalid/synthetic-module")',
    'importScripts("data:text/javascript,globalThis.fixture=1")',
    'new Worker("blob:https://package.invalid/synthetic-worker")',
    "import(`data:text/javascript,globalThis.fixture=1`)",
    "importScripts(`blob:https://package.invalid/synthetic-import-script`)",
    "new Worker(`data:text/javascript,globalThis.fixture=1`)",
    'import("\\x64ata:text/javascript,globalThis.fixture=1")',
    "importScripts('\\u0062lob:https://package.invalid/escaped-import-script')",
    "new Worker(`\\u{64}ata:text/javascript,globalThis.fixture=1`)",
    'import("\\x00data:text/javascript,globalThis.fixture=1\\u001f ")',
    'new Worker(" \\bblob:https://package.invalid/control-wrapped-worker\\f")',
  ])(
    "rejects a data or blob URL used as executable script: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "game.js": source,
        "index.html": '<!doctype html><script src="game.js"></script>',
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).toContain("SCRIPT_URL_NOT_ALLOWED");
    },
  );

  it.each([
    String.raw`import("\1data:text/javascript,globalThis.fixture=1")`,
    String.raw`new Worker("\142lob:https://package.invalid/legacy-octal-worker")`,
  ])(
    "rejects a data or blob URL encoded with a legacy octal escape: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "game.js": source,
        "index.html": '<!doctype html><script src="game.js"></script>',
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).toContain("SCRIPT_URL_NOT_ALLOWED");
    },
  );

  it.each([
    'import(("data:text/javascript,globalThis.fixture=1"))',
    'importScripts("safe.js", (("blob:https://package.invalid/grouped-import-script")))',
    '(importScripts)(("data:text/javascript,globalThis.fixture=1"))',
    'new (Worker)(("data:text/javascript,globalThis.fixture=1"))',
    'new ((SharedWorker))(("blob:https://package.invalid/grouped-shared-worker"))',
  ])(
    "rejects a parenthesized static executable script URL: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "game.js": source,
        "index.html": '<!doctype html><script src="game.js"></script>',
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).toContain("SCRIPT_URL_NOT_ALLOWED");
    },
  );

  it.each([
    'new window.Worker("data:text/javascript,globalThis.fixture=1")',
    'new self.SharedWorker("blob:https://package.invalid/member-shared-worker")',
    'new globalThis.Worker("blob:https://package.invalid/member-worker")',
    'new window["Worker"]("data:text/javascript,globalThis.fixture=1")',
    'self.importScripts("data:text/javascript,globalThis.fixture=1")',
    'self["importScripts"]("data:text/javascript,globalThis.fixture=1")',
    'importScripts?.("blob:https://package.invalid/optional-import-script")',
    'globalThis.importScripts("safe.js", "blob:https://package.invalid/member-import-script")',
  ])("rejects a direct global member script URL: %s", async (source) => {
    const directory = await createRuntimePackage({
      "game.js": source,
      "index.html": '<!doctype html><script src="game.js"></script>',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SCRIPT_URL_NOT_ALLOWED");
  });

  it.each([
    'importScripts("safe.js", "data:text/javascript,globalThis.fixture=1")',
    'importScripts("safe.js", "second.js", "blob:https://package.invalid/synthetic-import-script")',
    'importScripts(runtimeScriptUrl, "data:text/javascript,globalThis.fixture=1")',
  ])(
    "rejects a data or blob URL in any importScripts argument: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "game.js": source,
        "index.html": '<!doctype html><script src="game.js"></script>',
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).toContain("SCRIPT_URL_NOT_ALLOWED");
    },
  );

  it.each([
    'object.import("data:text/javascript,globalThis.fixture=1")',
    'object /* gap */ . /* gap */ import("blob:https://package.invalid/method")',
  ])(
    "does not treat an import method call as dynamic import: %s",
    async (source) => {
      const directory = await createRuntimePackage({
        "game.js": source,
        "index.html": '<!doctype html><script src="game.js"></script>',
      });

      const report = await validateGamePackage(directory);

      expect(issueCodes(report.errors)).not.toContain("SCRIPT_URL_NOT_ALLOWED");
    },
  );

  it.each([
    "asset.src = 'fixed.js'",
    "fetch( 'fixed.json')",
    "asset.setAttribute('src', 'fixed.js')",
    "asset.src = `fixed.js`",
    "asset.setAttribute('src', `fixed.js`)",
  ])("does not warn for a static resource literal: %s", async (source) => {
    const directory = await createRuntimePackage({
      "index.html": '<!doctype html><script src="game.js"></script>',
      "fixed.js": "export {};",
      "game.js": source,
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.warnings)).not.toContain("DYNAMIC_RESOURCE");
  });

  it.each([
    "asset.src = 'assets/' + assetName",
    "asset.src = `assets/${assetName}.js`",
    "asset.setAttribute('src', 'assets/' + assetName)",
    "asset.setAttribute('src', `assets/${assetName}.js`)",
  ])("warns for a composed resource value: %s", async (source) => {
    const directory = await createRuntimePackage({
      "index.html": '<!doctype html><script src="game.js"></script>',
      "game.js": source,
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.warnings)).toContain("DYNAMIC_RESOURCE");
  });

  it.each([
    "new Worker(workerUrl)",
    "new SharedWorker(workerUrl)",
    "new globalThis.Worker(workerUrl)",
    'new globalThis.SharedWorker("workers/" + workerName)',
    "new self.Worker(workerUrl)",
    "new self.SharedWorker(workerUrl)",
    "new window.Worker(workerUrl)",
    "new window.SharedWorker(workerUrl)",
  ])("warns for a dynamic worker constructor URL: %s", async (source) => {
    const directory = await createRuntimePackage({
      "game.js": source,
      "index.html": '<!doctype html><script src="game.js"></script>',
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(issueCodes(report.warnings)).toContain("DYNAMIC_RESOURCE");
  });

  it("does not warn for a static SharedWorker URL", async () => {
    const directory = await createRuntimePackage({
      "game.js": 'new globalThis.SharedWorker("workers/worker.js")',
      "index.html": '<!doctype html><script src="game.js"></script>',
      "workers/worker.js": "globalThis.onconnect = () => {};",
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(issueCodes(report.warnings)).not.toContain("DYNAMIC_RESOURCE");
  });

  it.each(["https://cdn.example.test/game.js", "//cdn.example.test/game.js"])(
    "warns about an external import-map target: %s",
    async (target) => {
      const directory = await createRuntimePackage({
        "index.html": `<!doctype html><script type="importmap">${JSON.stringify(
          {
            imports: {
              fixture: target,
              navigationExample:
                "https://cdn.example.test/window.top.location.js",
            },
          },
        )}</script>`,
      });

      const report = await validateGamePackage(directory);

      expect(report.ok).toBe(true);
      expect(issueCodes(report.warnings)).toContain("EXTERNAL_SCRIPT");
      expect(issueCodes(report.errors)).not.toContain("TOP_NAVIGATION");
    },
  );

  it.each([
    "data:text/javascript,globalThis.fixture=1",
    "blob:https://package.invalid/synthetic-import-map-module",
  ])("rejects an executable import-map target: %s", async (target) => {
    const directory = await createRuntimePackage({
      "index.html": `<!doctype html><script type="importmap">${JSON.stringify({
        imports: { fixture: target },
      })}</script>`,
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("SCRIPT_URL_NOT_ALLOWED");
  });

  it("does not treat local or bare import-map targets as missing files", async () => {
    const directory = await createRuntimePackage({
      "game.js": "export {};",
      "index.html": `<!doctype html><script type="importmap">${JSON.stringify({
        imports: {
          bare: "fixture-package",
          local: "./game.js",
        },
      })}</script>`,
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(issueCodes(report.errors)).not.toEqual(
      expect.arrayContaining(["RESOURCE_MISSING", "SCRIPT_URL_NOT_ALLOWED"]),
    );
  });

  it("warns without hard-failing when an import map is not valid JSON", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><script type="importmap">{not valid JSON}</script>',
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(issueCodes(report.warnings)).toContain("IMPORT_MAP_UNPARSEABLE");
  });

  it("rejects a javascript: form action override", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><form><button formaction="javascript:alert(1)">Submit</button></form>',
    });

    const report = await validateGamePackage(directory);

    expect(issueCodes(report.errors)).toContain("JAVASCRIPT_URL");
  });

  it("warns about an external form action override", async () => {
    const directory = await createRuntimePackage({
      "index.html":
        '<!doctype html><form><button formaction="https://forms.example.test/submit">Submit</button></form>',
    });

    const report = await validateGamePackage(directory);

    expect(report.ok).toBe(true);
    expect(issueCodes(report.warnings)).toContain("EXTERNAL_FORM");
  });
});

describe("game package validator CLI", () => {
  const runCli = (...args: string[]) =>
    spawnSync(process.execPath, [validatorScript, ...args], {
      cwd: resolve(import.meta.dirname, "../.."),
      encoding: "utf8",
    });

  it("prints a human-readable passing summary", () => {
    const result = runCli(fixture("valid"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Game package validation: PASS");
    expect(result.stdout).toMatch(/Files:\s+6/);
    expect(result.stdout).toContain("Entry: index.html");
    expect(result.stdout).toContain("Errors: none");
    expect(result.stdout).toContain("Warnings: none");
  });

  it("prints JSON only and returns zero for a valid package", () => {
    const result = runCli("--json", fixture("valid"));
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      errors: unknown[];
    };

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(report).toMatchObject({ ok: true, errors: [] });
  });

  it("returns non-zero for a hard failure", () => {
    const result = runCli(fixture("top-navigation"));

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Game package validation: FAIL");
    expect(result.stdout).toContain("TOP_NAVIGATION");
  });

  it("supports a small --max-file-mb threshold", () => {
    const result = runCli(
      "--json",
      "--max-file-mb",
      "0.000001",
      fixture("valid"),
    );
    const report = JSON.parse(result.stdout) as {
      errors: { code: string }[];
    };

    expect(result.status).toBe(1);
    expect(issueCodes(report.errors)).toContain("FILE_TOO_LARGE");
  });

  it("returns usage exit code 2 for an invalid size argument", () => {
    const result = runCli(
      "--json",
      "--max-file-mb",
      "100oops",
      fixture("valid"),
    );
    const report = JSON.parse(result.stdout) as {
      errors: { code: string }[];
    };

    expect(result.status).toBe(2);
    expect(issueCodes(report.errors)).toContain("CLI_USAGE");
  });

  it("never prints secret contents in either output mode", async () => {
    const fakeSecret = "DO_NOT_PRINT_THIS_FIXTURE_VALUE";
    const directory = await createRuntimePackage({
      ".env": `TOKEN=${fakeSecret}`,
      "index.html": "<!doctype html><title>Fixture</title>",
    });

    const human = runCli(directory);
    const json = runCli("--json", directory);

    expect(human.status).toBe(1);
    expect(json.status).toBe(1);
    expect(
      `${human.stdout}${human.stderr}${json.stdout}${json.stderr}`,
    ).not.toContain(fakeSecret);
  });

  it("neutralizes control and ANSI characters in issue paths and JSON", async () => {
    const c1Marker = "\u009b";
    const hostilePath = `assets/control${c1Marker}31m.pem`;
    const directory = await createRuntimePackage({
      [hostilePath]: "fixture key container",
      "index.html": "<!doctype html><title>Fixture</title>",
    });

    const report = await validateGamePackage(directory);
    const issue = report.errors.find(
      ({ code }: { code: string }) => code === "SECRET_FILE",
    );
    const serialized = JSON.stringify(report);
    const reparsed = JSON.parse(serialized) as typeof report;

    expect(issue?.path).toBeDefined();
    expect(issue?.path).not.toContain(c1Marker);
    expect(serialized).not.toContain(c1Marker);
    expect(reparsed.errors).toHaveLength(report.errors.length);

    const rawControls = `unsafe\r\n\u0000\u001b[31m\u007f\u0085\u009b31m`;
    const human = formatHumanReport({
      ...report,
      errors: [
        {
          code: "SYNTHETIC_PATH",
          path: rawControls,
          message: "Synthetic path safety check.",
        },
      ],
      warnings: [],
    });

    expect(human).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u);
    expect(human.split("\n")).toHaveLength(8);
    expect(human).toContain("\\u001b");
    expect(human).toContain("\\u009b");
  });
});
