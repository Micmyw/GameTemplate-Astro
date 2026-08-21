import { isGameEntryPath } from "../../lib/embed-url.ts";

export const GAME_LOAD_TIMEOUT_MS = 15_000;
export const GAME_FRAME_ALLOW = "fullscreen; autoplay; gamepad";
export const GAME_FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-pointer-lock";
export const GAME_FRAME_REFERRER_POLICY = "strict-origin-when-cross-origin";

export type GameFrameAttributes = {
  title: string;
  allow: typeof GAME_FRAME_ALLOW;
  sandbox: typeof GAME_FRAME_SANDBOX;
  referrerpolicy: typeof GAME_FRAME_REFERRER_POLICY;
  allowfullscreen: true;
};

export function getGameFrameAttributes(title: string): GameFrameAttributes {
  return {
    title: `Play ${title}`,
    allow: GAME_FRAME_ALLOW,
    sandbox: GAME_FRAME_SANDBOX,
    referrerpolicy: GAME_FRAME_REFERRER_POLICY,
    allowfullscreen: true,
  };
}

type CreateGameFrameOptions = {
  title: string;
  src: string;
};

function parseRuntimeSource(raw: string): URL {
  const source = new URL(raw);

  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.hash ||
    raw.includes("#") ||
    !isGameEntryPath(source.pathname)
  ) {
    throw new Error("Game source must be a validated HTTPS game URL");
  }

  return source;
}

export function createGameFrame(
  ownerDocument: Document,
  { title, src }: CreateGameFrameOptions,
): HTMLIFrameElement {
  const frame = ownerDocument.createElement("iframe");
  const attributes = getGameFrameAttributes(title);

  frame.setAttribute("title", attributes.title);
  frame.setAttribute("allow", attributes.allow);
  frame.setAttribute("sandbox", attributes.sandbox);
  frame.setAttribute("referrerpolicy", attributes.referrerpolicy);
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("src", parseRuntimeSource(src).href);

  return frame;
}

const mountedPlayers = new WeakSet<HTMLElement>();

const requiredElement = <T extends Element>(
  root: ParentNode,
  selector: string,
): T => {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`GamePlayer is missing ${selector}`);
  }
  return element as T;
};

export function mountGamePlayer(root: HTMLElement): void {
  if (mountedPlayers.has(root)) return;
  mountedPlayers.add(root);

  const status = requiredElement<HTMLElement>(root, "[data-game-status]");
  const host = requiredElement<HTMLElement>(root, "[data-game-frame-host]");
  const reloadButton = requiredElement<HTMLButtonElement>(
    root,
    "[data-game-reload]",
  );
  const fullscreenButton = requiredElement<HTMLButtonElement>(
    root,
    "[data-game-fullscreen]",
  );
  const playButton = root.querySelector<HTMLButtonElement>("[data-game-play]");
  const poster = root.querySelector<HTMLElement>("[data-game-poster]");
  const title = root.dataset.title?.trim();
  const rawSource = root.dataset.src?.trim();

  const setState = (state: string, message: string): void => {
    root.dataset.state = state;
    status.textContent = message;
  };

  if (!title || !rawSource) {
    playButton && (playButton.disabled = true);
    reloadButton.disabled = true;
    fullscreenButton.disabled = true;
    setState("unavailable", "The game player is unavailable.");
    return;
  }

  let source: string;
  try {
    source = parseRuntimeSource(rawSource).href;
  } catch {
    playButton && (playButton.disabled = true);
    reloadButton.disabled = true;
    fullscreenButton.disabled = true;
    setState("unavailable", "The game player has an invalid source.");
    return;
  }

  let frame = host.querySelector<HTMLIFrameElement>("iframe");
  let loadTimeout: ReturnType<typeof setTimeout> | undefined;

  const clearLoadTimeout = (): void => {
    if (loadTimeout !== undefined) {
      clearTimeout(loadTimeout);
      loadTimeout = undefined;
    }
  };

  const updateControls = (): void => {
    if (playButton) playButton.disabled = frame !== null;
    reloadButton.disabled = frame === null;
    fullscreenButton.disabled = frame === null;
  };

  const watchFrame = (nextFrame: HTMLIFrameElement): void => {
    clearLoadTimeout();

    if (nextFrame.dataset.gameFrameState === "loaded") {
      setState("loaded", "Game loaded");
      return;
    }
    if (nextFrame.dataset.gameFrameState === "error") {
      setState("error", "The game could not load. Try reloading it.");
      return;
    }

    nextFrame.addEventListener(
      "load",
      () => {
        if (frame !== nextFrame) return;
        nextFrame.dataset.gameFrameState = "loaded";
        clearLoadTimeout();
        setState("loaded", "Game loaded");
      },
      { once: true },
    );
    nextFrame.addEventListener(
      "error",
      () => {
        if (frame !== nextFrame) return;
        nextFrame.dataset.gameFrameState = "error";
        clearLoadTimeout();
        setState("error", "The game could not load. Try reloading it.");
      },
      { once: true },
    );

    loadTimeout = setTimeout(() => {
      if (frame !== nextFrame) return;
      setState(
        "delayed",
        "The game is still loading. You can wait or reload the game.",
      );
    }, GAME_LOAD_TIMEOUT_MS);
  };

  const replaceFrame = (): void => {
    clearLoadTimeout();
    const nextFrame = createGameFrame(root.ownerDocument, {
      title,
      src: source,
    });
    frame = nextFrame;
    if (poster) poster.hidden = true;
    setState("loading", "Loading game…");
    updateControls();
    watchFrame(nextFrame);
    host.replaceChildren(nextFrame);
  };

  playButton?.addEventListener("click", () => {
    if (frame) return;
    replaceFrame();
  });

  reloadButton.addEventListener("click", () => {
    replaceFrame();
  });

  fullscreenButton.addEventListener("click", () => {
    const activeFrame = frame;
    if (!activeFrame) return;

    if (typeof activeFrame.requestFullscreen !== "function") {
      setState(
        "fullscreen-error",
        "Fullscreen is not available in this browser.",
      );
      return;
    }

    void activeFrame.requestFullscreen().catch(() => {
      if (frame !== activeFrame) return;
      setState(
        "fullscreen-error",
        "The game could not enter fullscreen. You can keep playing here.",
      );
    });
  });

  updateControls();
  if (frame) {
    setState("loading", "Loading game…");
    watchFrame(frame);
  }
}

export function mountGamePlayers(scope: ParentNode = document): void {
  scope.querySelectorAll<HTMLElement>("[data-game-player]").forEach((root) => {
    try {
      mountGamePlayer(root);
    } catch (error) {
      const status = root.querySelector<HTMLElement>("[data-game-status]");
      if (status) {
        root.dataset.state = "unavailable";
        status.textContent = "The game player is unavailable.";
      }
      console.error(error);
    }
  });
}
