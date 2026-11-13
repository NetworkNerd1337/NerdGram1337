/**
 * Fullscreen on the presentation container. A denied or unsupported request
 * leaves the full-window overlay in place; the control bar retries from a click.
 *
 * `startPresentation` opens the UI inside the user gesture (click or keydown)
 * and asks for fullscreen on that same turn. A deep link has no gesture, so
 * the request fails and the overlay stays.
 */

import { flushSync } from "react-dom";

export const PRESENTATION_ROOT_ID = "presentation-root";

type FullscreenHost = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
};

export function currentFullscreen(): Element | null {
  if (typeof document === "undefined") return null;
  const legacy = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? legacy.webkitFullscreenElement ?? null;
}

export async function requestElementFullscreen(element: HTMLElement): Promise<boolean> {
  const target = element as FullscreenHost;
  const request = target.requestFullscreen?.bind(target) ?? target.webkitRequestFullscreen?.bind(target);
  if (!request) return false;
  try {
    await request();
    return currentFullscreen() === element;
  } catch {
    return false;
  }
}

let inflight: Promise<boolean> | null = null;

/**
 * Fullscreen the mounted presentation root. Safe to call twice.
 * Pass `force` from a click or key handler. The mount effect omits it so a
 * deep link does not ask and the browser does not log a rejection.
 */
export function requestPresentationFullscreen(options?: { force?: boolean }): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  const element = document.getElementById(PRESENTATION_ROOT_ID);
  if (!(element instanceof HTMLElement)) return Promise.resolve(false);
  if (currentFullscreen() === element) return Promise.resolve(true);
  const activation = navigator.userActivation;
  if (!options?.force && activation && !activation.isActive) return Promise.resolve(false);
  if (inflight) return inflight;
  inflight = requestElementFullscreen(element).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Mount the presentation UI, then request fullscreen while the gesture is active. */
export function startPresentation(open: () => void): void {
  flushSync(open);
  void requestPresentationFullscreen({ force: true });
}

export async function exitPresentationFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  const element = document.getElementById(PRESENTATION_ROOT_ID);
  if (!element || currentFullscreen() !== element) return;
  const host = document as FullscreenDocument;
  const exit = host.exitFullscreen?.bind(host) ?? host.webkitExitFullscreen?.bind(host);
  if (!exit) return;
  try {
    await exit();
  } catch {
    // The browser may already have left fullscreen.
  }
}
