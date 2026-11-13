import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { api } from "../src/api";
import { EditorLockBanner, TakeoverDialog } from "../src/components/EditorLockBanner";
import { OTHER_WINDOW_NOTE, lockReleaseBeaconBody, releaseEditorLock } from "../src/lib/editorLock";

describe("editor lock release", () => {
  it("queues application/json with sendBeacon so navigation cannot abort the release", async () => {
    const blob = lockReleaseBeaconBody("Notes.mmd", "token-1");
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual({ path: "Notes.mmd", token: "token-1" });

    const sent: { url: string; body: Blob }[] = [];
    const queued = releaseEditorLock("Notes.mmd", "token-1", {
      sendBeacon: (url, body) => {
        sent.push({ url, body });
        return true;
      },
      keepaliveRelease: () => {
        throw new Error("keepalive fetch should not run when beacon accepts the body");
      },
    });
    expect(queued).toBe(true);
    expect(sent[0]?.url).toBe("/api/lock/release");
    expect(sent[0]?.body.type).toBe("application/json");
    expect(JSON.parse(await sent[0].body.text())).toEqual({ path: "Notes.mmd", token: "token-1" });
  });

  it("falls back to a keepalive release when sendBeacon is unavailable", () => {
    const calls: { path: string; token: string }[] = [];
    const queued = releaseEditorLock("Notes.mmd", "token-1", {
      sendBeacon: () => false,
      keepaliveRelease: (path, token) => {
        calls.push({ path, token });
      },
    });
    expect(queued).toBe(false);
    expect(calls).toEqual([{ path: "Notes.mmd", token: "token-1" }]);
  });
});

describe("stale lock takeover", () => {
  it("posts takeover and accepts a lock the server reports as stale", async () => {
    const calls: { url: string; body: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          path: "Notes.mmd",
          token: "new-token",
          sessionId: "tab-two",
          heartbeatAt: new Date().toISOString(),
          acquiredAt: new Date(Date.now() - 120_000).toISOString(),
          heartbeatEveryMs: 15_000,
          staleAfterMs: 90_000,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const lock = await api.takeoverLock("Notes.mmd", "tab-two");
      expect(calls[0]?.url).toBe("/api/lock/takeover");
      expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ path: "Notes.mmd", sessionId: "tab-two" });
      expect(lock.token).toBe("new-token");
      expect(lock.staleAfterMs).toBe(90_000);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("keeps the diagram read-only when the other window still holds a fresh lock", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "This diagram is open in another window.",
          code: "locked",
          lock: { heartbeatAt: new Date().toISOString(), staleAfterMs: 90_000 },
        }),
        { status: 423, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      await expect(api.takeoverLock("Notes.mmd", "tab-two")).rejects.toMatchObject({
        status: 423,
        code: "locked",
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("editor lock banner", () => {
  it("offers Take over editing on the read-only banner and explains the confirmation", () => {
    const banner = renderToStaticMarkup(
      createElement(EditorLockBanner, {
        note: OTHER_WINDOW_NOTE,
        readOnly: true,
        dirty: true,
        copyNote: null,
        onTakeOver: () => undefined,
        onSaveCopy: () => undefined,
      }),
    );
    expect(banner).toContain(OTHER_WINDOW_NOTE);
    expect(banner).toContain("Take over editing");
    expect(banner).toContain("Save a copy");

    const dialog = renderToStaticMarkup(
      createElement(TakeoverDialog, { onClose: () => undefined, onConfirm: () => undefined }),
    );
    expect(dialog).toContain("Take over editing?");
    expect(dialog).toContain("stopped refreshing");
    expect(dialog).toContain("still editing keeps the lock");
  });
});
