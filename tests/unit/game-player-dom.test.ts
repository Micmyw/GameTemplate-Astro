import { Response, Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GAME_LOAD_TIMEOUT_MS,
  mountGamePlayer,
  mountGamePlayers,
} from "../../src/components/games/game-player";

const clickPlayerMarkup = (title = "Going Balls", slug = "going-balls") => `
  <section
    data-game-player
    data-load-mode="click"
    data-src="https://play.example.com/${slug}/index.html"
    data-title="${title}"
    data-state="idle"
  >
    <div data-game-stage>
      <div data-game-frame-host></div>
      <div data-game-poster>
        <button type="button" data-game-play>Play ${title}</button>
      </div>
    </div>
    <div>
      <button type="button" data-game-reload disabled>Reload game</button>
      <button type="button" data-game-fullscreen disabled>Fullscreen</button>
    </div>
    <p data-game-status role="status" aria-live="polite">Ready to play</p>
  </section>
`;

const eagerPlayerMarkup = (title = "Going Balls", slug = "going-balls") => `
  <section
    data-game-player
    data-load-mode="eager"
    data-src="https://play.example.com/${slug}/index.html"
    data-title="${title}"
    data-state="loading"
  >
    <div data-game-stage>
      <div data-game-frame-host>
        <iframe src="https://play.example.com/${slug}/index.html" title="Play ${title}"></iframe>
      </div>
    </div>
    <div>
      <button type="button" data-game-reload>Reload game</button>
      <button type="button" data-game-fullscreen>Fullscreen</button>
    </div>
    <p data-game-status role="status" aria-live="polite">Loading game…</p>
  </section>
`;

const button = (root: ParentNode, selector: string): HTMLButtonElement => {
  const element = root.querySelector(selector);
  if (!element || element.tagName !== "BUTTON") {
    throw new Error(`Missing button ${selector}`);
  }
  return element as HTMLButtonElement;
};

let testWindow: Window;
let testDocument: Document;

const player = (): HTMLElement => {
  const root = testDocument.querySelector("[data-game-player]");
  if (!root) throw new Error("Missing player root");
  return root as HTMLElement;
};

beforeEach(() => {
  vi.useFakeTimers();
  testWindow = new Window({
    url: "https://site.example.com/",
    settings: {
      fetch: {
        interceptor: {
          beforeAsyncRequest: async ({ request }) => {
            if (new URL(request.url).origin === "https://play.example.com") {
              return new Response(
                "<!doctype html><title>Game fixture</title>",
                {
                  headers: { "content-type": "text/html" },
                },
              );
            }
            return undefined;
          },
        },
      },
    },
  });
  testDocument = testWindow.document as unknown as Document;
  testDocument.body.innerHTML = clickPlayerMarkup();
});

afterEach(async () => {
  vi.useRealTimers();
  testDocument.body.replaceChildren();
  await testWindow.happyDOM.abort();
  testWindow.close();
});

describe("GamePlayer DOM behavior", () => {
  it("creates one secured iframe after the native Play button is clicked", () => {
    const root = player();
    mountGamePlayer(root);

    button(root, "[data-game-play]").click();

    const frames = root.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame?.getAttribute("src")).toBe(
      "https://play.example.com/going-balls/index.html",
    );
    expect(frame?.getAttribute("title")).toBe("Play Going Balls");
    expect(frame?.getAttribute("allow")).toBe("fullscreen; autoplay; gamepad");
    expect(frame?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-pointer-lock",
    );
    expect(frame?.getAttribute("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(frame?.hasAttribute("allowfullscreen")).toBe(true);
    expect(frame?.hasAttribute("srcdoc")).toBe(false);
    expect(root.dataset.state).toBe("loading");
    expect(root.querySelector("[data-game-status]")?.textContent).toContain(
      "Loading",
    );
    expect(button(root, "[data-game-play]").disabled).toBe(true);
    expect(button(root, "[data-game-reload]").disabled).toBe(false);
    expect(button(root, "[data-game-fullscreen]").disabled).toBe(false);
    expect(
      (root.querySelector("[data-game-poster]") as HTMLElement).hidden,
    ).toBe(true);
  });

  it("rejects a runtime source that does not target the exact index.html entry", () => {
    testDocument.body.innerHTML = clickPlayerMarkup().replace(
      "/going-balls/index.html",
      "/going-balls/",
    );
    const root = player();

    mountGamePlayer(root);

    expect(root.dataset.state).toBe("unavailable");
    expect(button(root, "[data-game-play]").disabled).toBe(true);
    expect(root.querySelector("iframe")).toBeNull();
  });

  it("rejects an empty fragment in the runtime source", () => {
    testDocument.body.innerHTML = clickPlayerMarkup().replace(
      "/going-balls/index.html",
      "/going-balls/index.html#",
    );
    const root = player();

    mountGamePlayer(root);

    expect(root.dataset.state).toBe("unavailable");
    expect(button(root, "[data-game-play]").disabled).toBe(true);
    expect(root.querySelector("iframe")).toBeNull();
  });

  it("keeps one iframe after repeated Play clicks and repeated mounting", () => {
    const root = player();
    mountGamePlayer(root);
    mountGamePlayer(root);

    const play = button(root, "[data-game-play]");
    play.click();
    const firstFrame = root.querySelector("iframe");
    play.click();

    expect(root.querySelectorAll("iframe")).toHaveLength(1);
    expect(root.querySelector("iframe")).toBe(firstFrame);
  });

  it("replaces the old iframe and timeout when Reload is clicked", () => {
    const root = player();
    mountGamePlayer(root);
    button(root, "[data-game-play]").click();
    const firstFrame = root.querySelector("iframe");

    button(root, "[data-game-reload]").click();
    const secondFrame = root.querySelector("iframe");

    expect(root.querySelectorAll("iframe")).toHaveLength(1);
    expect(secondFrame).not.toBe(firstFrame);
    firstFrame?.dispatchEvent(new testWindow.Event("load") as unknown as Event);
    expect(root.dataset.state).toBe("loading");
    expect(root.querySelector("[data-game-status]")?.textContent).toContain(
      "Loading",
    );
  });

  it("reports a successful iframe load and clears the delay timeout", () => {
    const root = player();
    mountGamePlayer(root);
    button(root, "[data-game-play]").click();

    root
      .querySelector("iframe")
      ?.dispatchEvent(new testWindow.Event("load") as unknown as Event);
    vi.advanceTimersByTime(GAME_LOAD_TIMEOUT_MS);

    expect(root.dataset.state).toBe("loaded");
    expect(root.querySelector("[data-game-status]")?.textContent).toBe(
      "Game loaded",
    );
  });

  it("recognizes an eager iframe that loaded before the player mounted", () => {
    testDocument.body.innerHTML = eagerPlayerMarkup();
    const root = player();
    const host = root.querySelector<HTMLElement>("[data-game-frame-host]");
    const frame = root.querySelector<HTMLIFrameElement>("iframe");
    if (!host || !frame) throw new Error("Missing eager iframe fixture");

    host.addEventListener(
      "load",
      (event) => {
        if (event.target === frame) frame.dataset.gameFrameState = "loaded";
      },
      { capture: true },
    );
    frame.dispatchEvent(new testWindow.Event("load") as unknown as Event);

    mountGamePlayer(root);
    vi.advanceTimersByTime(GAME_LOAD_TIMEOUT_MS);

    expect(root.dataset.state).toBe("loaded");
    expect(root.querySelector("[data-game-status]")?.textContent).toBe(
      "Game loaded",
    );
  });

  it("reports an iframe error without claiming details it cannot observe", () => {
    const root = player();
    mountGamePlayer(root);
    button(root, "[data-game-play]").click();

    root
      .querySelector("iframe")
      ?.dispatchEvent(new testWindow.Event("error") as unknown as Event);

    expect(root.dataset.state).toBe("error");
    expect(root.querySelector("[data-game-status]")?.textContent).toMatch(
      /could not load/i,
    );
    expect(root.querySelector("[data-game-status]")?.textContent).toMatch(
      /reload/i,
    );
  });

  it("describes a timeout as a delayed load rather than a certain error", () => {
    const root = player();
    mountGamePlayer(root);
    button(root, "[data-game-play]").click();

    vi.advanceTimersByTime(GAME_LOAD_TIMEOUT_MS);

    expect(root.dataset.state).toBe("delayed");
    expect(root.querySelector("[data-game-status]")?.textContent).toMatch(
      /still loading/i,
    );
    expect(root.querySelector("[data-game-status]")?.textContent).toMatch(
      /reload/i,
    );
  });

  it("shows a useful status when a user-triggered fullscreen request fails", async () => {
    const root = player();
    mountGamePlayer(root);
    button(root, "[data-game-play]").click();
    const frame = root.querySelector("iframe");
    if (!frame) throw new Error("Missing iframe");
    frame.requestFullscreen = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("Fullscreen denied"));

    button(root, "[data-game-fullscreen]").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.dataset.state).toBe("fullscreen-error");
    expect(root.querySelector("[data-game-status]")?.textContent).toMatch(
      /could not.*fullscreen|fullscreen.*could not/i,
    );
  });

  it("mounts multiple players independently and remains idempotent", () => {
    testDocument.body.innerHTML =
      clickPlayerMarkup("Going Balls", "going-balls") +
      clickPlayerMarkup("Roll Ball 3D", "roll-ball-3d");

    mountGamePlayers(testDocument);
    mountGamePlayers(testDocument);
    const roots =
      testDocument.querySelectorAll<HTMLElement>("[data-game-player]");
    button(roots[0]!, "[data-game-play]").click();
    button(roots[1]!, "[data-game-play]").click();

    expect(roots[0]?.querySelectorAll("iframe")).toHaveLength(1);
    expect(roots[1]?.querySelectorAll("iframe")).toHaveLength(1);
    expect(roots[0]?.querySelector("iframe")?.title).toBe("Play Going Balls");
    expect(roots[1]?.querySelector("iframe")?.title).toBe("Play Roll Ball 3D");
  });
});
