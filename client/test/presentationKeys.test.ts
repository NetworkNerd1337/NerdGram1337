import { describe, expect, it } from "vitest";
import {
  PAN_STEP,
  ZOOM_STEP,
} from "../src/lib/viewTransform";
import {
  presentationAction,
  targetKind,
  wheelGesture,
  type KeyContext,
  type KeyEvent,
} from "../src/lib/presentationKeys";

function key(partial: Partial<KeyEvent> & { key: string }): KeyEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...partial,
  };
}

function ctx(partial: Partial<KeyContext> = {}): KeyContext {
  return {
    presenting: false,
    available: true,
    formField: false,
    codeEditor: false,
    atFit: true,
    ...partial,
  };
}

const form = targetKind({
  tagName: "INPUT",
  isContentEditable: false,
  closest: () => false,
});

const editor = targetKind({
  tagName: "DIV",
  isContentEditable: true,
  closest: (selector) => selector.includes("cm-editor"),
});

describe("presentation keys", () => {
  it("classifies form fields and the code editor separately", () => {
    expect(form).toBe("form");
    expect(editor).toBe("editor");
    expect(
      targetKind({
        tagName: "DIV",
        isContentEditable: false,
        closest: () => false,
      }),
    ).toBe("other");
    expect(
      targetKind({
        tagName: "DIV",
        isContentEditable: true,
        closest: (selector) => selector.includes("contenteditable"),
      }),
    ).toBe("form");
  });

  it("starts on F5 and Ctrl/Cmd+Shift+Enter, except in a form field or when nothing is open", () => {
    expect(presentationAction(key({ key: "F5" }), ctx()).type).toBe("start");
    expect(presentationAction(key({ key: "Enter", ctrlKey: true, shiftKey: true }), ctx()).type).toBe(
      "start",
    );
    expect(presentationAction(key({ key: "Enter", metaKey: true, shiftKey: true }), ctx()).type).toBe(
      "start",
    );
    expect(
      presentationAction(key({ key: "F5" }), ctx({ formField: form === "form" })).type,
    ).toBe("ignore");
    expect(
      presentationAction(key({ key: "F5" }), ctx({ codeEditor: editor === "editor" })).type,
    ).toBe("start");
    expect(presentationAction(key({ key: "F5", ctrlKey: true }), ctx()).type).toBe("ignore");
    expect(presentationAction(key({ key: "F5" }), ctx({ available: false })).type).toBe("ignore");
    expect(presentationAction(key({ key: "F5", repeat: true }), ctx()).type).toBe("ignore");
    expect(presentationAction(key({ key: "F5" }), ctx({ presenting: true })).type).toBe("suppress");
    expect(
      presentationAction(key({ key: "Enter", ctrlKey: true, shiftKey: true, altKey: true }), ctx()).type,
    ).toBe("ignore");
  });

  it("does not pan, zoom, or rotate while typing in the editor or a form field", () => {
    const typing = ctx({ codeEditor: true, presenting: false });
    expect(presentationAction(key({ key: "w" }), typing).type).toBe("ignore");
    expect(presentationAction(key({ key: "r" }), typing).type).toBe("ignore");
    expect(presentationAction(key({ key: "f" }), typing).type).toBe("ignore");
    expect(presentationAction(key({ key: "0" }), typing).type).toBe("ignore");
    expect(presentationAction(key({ key: "+" }), typing).type).toBe("ignore");
    expect(presentationAction(key({ key: "ArrowLeft" }), typing).type).toBe("ignore");

    const field = ctx({ presenting: true, formField: true, atFit: false });
    expect(presentationAction(key({ key: "w" }), field).type).toBe("ignore");
    expect(presentationAction(key({ key: "Escape" }), field).type).toBe("ignore");
    expect(presentationAction(key({ key: "ArrowRight" }), field).type).toBe("ignore");
  });

  it("pans with WASD and Shift+arrows even at the fitted view, and with arrows only when zoomed", () => {
    const fitted = ctx({ presenting: true, atFit: true });
    const zoomed = ctx({ presenting: true, atFit: false });
    expect(presentationAction(key({ key: "w" }), fitted)).toEqual({ type: "pan", dx: 0, dy: PAN_STEP });
    expect(presentationAction(key({ key: "a" }), fitted)).toEqual({ type: "pan", dx: PAN_STEP, dy: 0 });
    expect(presentationAction(key({ key: "s" }), fitted)).toEqual({ type: "pan", dx: 0, dy: -PAN_STEP });
    expect(presentationAction(key({ key: "d" }), fitted)).toEqual({ type: "pan", dx: -PAN_STEP, dy: 0 });
    expect(presentationAction(key({ key: "ArrowRight", shiftKey: true }), fitted)).toEqual({
      type: "pan",
      dx: -PAN_STEP,
      dy: 0,
    });
    expect(presentationAction(key({ key: "ArrowUp", shiftKey: true }), fitted)).toEqual({
      type: "pan",
      dx: 0,
      dy: PAN_STEP,
    });
    expect(presentationAction(key({ key: "ArrowLeft" }), fitted).type).toBe("reserved");
    expect(presentationAction(key({ key: "ArrowRight" }), fitted).type).toBe("reserved");
    expect(presentationAction(key({ key: "ArrowLeft" }), zoomed)).toEqual({
      type: "pan",
      dx: PAN_STEP,
      dy: 0,
    });
    expect(presentationAction(key({ key: "ArrowDown" }), zoomed)).toEqual({
      type: "pan",
      dx: 0,
      dy: -PAN_STEP,
    });
    expect(presentationAction(key({ key: "w" }), ctx({ presenting: false })).type).toBe("ignore");
    expect(presentationAction(key({ key: "w", ctrlKey: true }), fitted).type).toBe("ignore");
  });

  it("rotates, zooms, resets, and exits only while presenting", () => {
    const live = ctx({ presenting: true, atFit: false });
    expect(presentationAction(key({ key: "r" }), live)).toEqual({ type: "rotate", degrees: 90 });
    expect(presentationAction(key({ key: "R", shiftKey: true }), live)).toEqual({
      type: "rotate",
      degrees: -90,
    });
    expect(presentationAction(key({ key: "+" }), live)).toEqual({ type: "zoom", factor: ZOOM_STEP });
    expect(presentationAction(key({ key: "=" }), live)).toEqual({ type: "zoom", factor: ZOOM_STEP });
    const zoomOut = presentationAction(key({ key: "-" }), live);
    expect(zoomOut.type).toBe("zoom");
    if (zoomOut.type === "zoom") expect(zoomOut.factor).toBeCloseTo(1 / ZOOM_STEP);
    expect(presentationAction(key({ key: "0" }), live).type).toBe("reset");
    expect(presentationAction(key({ key: "f" }), live).type).toBe("reset");
    expect(presentationAction(key({ key: "Escape" }), live).type).toBe("exit");
    expect(presentationAction(key({ key: "r" }), ctx()).type).toBe("ignore");
    expect(presentationAction(key({ key: "f", ctrlKey: true }), live).type).toBe("ignore");
  });

  it("treats a mouse wheel as zoom and a two-finger trackpad scroll as pan", () => {
    const mouse = wheelGesture({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, metaKey: false });
    expect(mouse.type).toBe("zoom");
    if (mouse.type === "zoom") expect(mouse.factor).toBeLessThan(1);

    const line = wheelGesture({ deltaX: 0, deltaY: -1, deltaMode: 1, ctrlKey: false, metaKey: false });
    expect(line.type).toBe("zoom");
    if (line.type === "zoom") expect(line.factor).toBeGreaterThan(1);

    const pinch = wheelGesture({ deltaX: 0, deltaY: 10, deltaMode: 0, ctrlKey: true, metaKey: false });
    expect(pinch.type).toBe("zoom");

    const trackpad = wheelGesture({ deltaX: 4, deltaY: 12.5, deltaMode: 0, ctrlKey: false, metaKey: false });
    expect(trackpad).toEqual({ type: "pan", dx: -4, dy: -12.5 });
  });
});
