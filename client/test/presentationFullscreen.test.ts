import { afterEach, describe, expect, it, vi } from "vitest";
import { exitPresentationFullscreen, PRESENTATION_ROOT_ID } from "../src/lib/presentationFullscreen";

describe("exitPresentationFullscreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when there is no document", async () => {
    await expect(exitPresentationFullscreen()).resolves.toBeUndefined();
  });

  it("uses exitFullscreen when the document provides it", async () => {
    const element = { id: PRESENTATION_ROOT_ID };
    const exitFullscreen = vi.fn(async () => undefined);
    const webkitExitFullscreen = vi.fn(async () => undefined);
    vi.stubGlobal("document", {
      getElementById: (id: string) => (id === PRESENTATION_ROOT_ID ? element : null),
      fullscreenElement: element,
      exitFullscreen,
      webkitExitFullscreen,
    });
    await exitPresentationFullscreen();
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(webkitExitFullscreen).not.toHaveBeenCalled();
  });

  it("falls back to webkitExitFullscreen when exitFullscreen is unavailable", async () => {
    const element = { id: PRESENTATION_ROOT_ID };
    const webkitExitFullscreen = vi.fn(async () => undefined);
    vi.stubGlobal("document", {
      getElementById: () => element,
      fullscreenElement: null,
      webkitFullscreenElement: element,
      webkitExitFullscreen,
    });
    await exitPresentationFullscreen();
    expect(webkitExitFullscreen).toHaveBeenCalledOnce();
  });

  it("does not exit when this view is not the fullscreen element", async () => {
    const exitFullscreen = vi.fn(async () => undefined);
    vi.stubGlobal("document", {
      getElementById: () => ({ id: PRESENTATION_ROOT_ID }),
      fullscreenElement: null,
      webkitFullscreenElement: null,
      exitFullscreen,
    });
    await exitPresentationFullscreen();
    expect(exitFullscreen).not.toHaveBeenCalled();
  });
});
