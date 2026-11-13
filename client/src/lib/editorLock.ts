import { api } from "../api";

const RELEASE_URL = "/api/lock/release";

export const OTHER_WINDOW_NOTE =
  "This diagram is open in another window. You can view it, but changes are not saved.";

export const STILL_HELD_NOTE =
  "The other window is still editing this diagram. Take over works once that lock stops refreshing.";

/** JSON body queued with sendBeacon. The mutation guard requires application/json. */
export function lockReleaseBeaconBody(path: string, token: string): Blob {
  return new Blob([JSON.stringify({ path, token })], { type: "application/json" });
}

type ReleaseTransport = {
  sendBeacon?: (url: string, data: Blob) => boolean;
  keepaliveRelease?: (path: string, token: string) => void;
};

/**
 * Release an editor lock without depending on a fetch the browser can abort
 * during navigation (`net::ERR_ABORTED`). sendBeacon is queued for delivery.
 * A keepalive fetch is the fallback when beacon is unavailable or refuses.
 */
export function releaseEditorLock(path: string, token: string, transport?: ReleaseTransport): boolean {
  const body = lockReleaseBeaconBody(path, token);
  const send =
    transport?.sendBeacon ??
    (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      ? (url: string, data: Blob) => navigator.sendBeacon(url, data)
      : undefined);
  if (send?.(RELEASE_URL, body)) return true;
  if (transport?.keepaliveRelease) {
    transport.keepaliveRelease(path, token);
    return false;
  }
  void api.releaseLock(path, token, { keepalive: true }).catch(() => undefined);
  return false;
}
