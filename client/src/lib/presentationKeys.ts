/**
 * Keyboard policy for presentation mode.
 *
 * F5 and Mod-Shift-Enter start presentation. They are not bound in the
 * command palette. F5 is also the browser reload key, so it is intercepted
 * only when a diagram can actually be presented:
 * - the window handler is installed by the editor (a diagram is open) and by
 *   the presentation view itself
 * - the target is not a form field (search, rename, diagram info, go to line,
 *   command palette). Those keep F5 as reload so the key is not surprising
 * - the code editor is not a form field: F5 presents even while it is focused
 *
 * WASD, R, F, 0, +/-, and arrows run only while presenting, and never when
 * the event target is a form field or the code editor. At the fitted view,
 * plain arrows are reserved for a later folder slideshow and do not pan.
 * Shift+arrows and WASD always pan.
 */

import { PAN_STEP, ZOOM_STEP } from "./viewTransform";

export type TargetKind = "form" | "editor" | "other";

export type TargetInfo = {
  tagName: string;
  isContentEditable: boolean;
  /** True when `selector` matches this element or an ancestor. */
  closest: (selector: string) => boolean;
};

export type KeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  composing?: boolean;
};

export type KeyContext = {
  presenting: boolean;
  /** A diagram is open in the editor, or presentation is already up. */
  available: boolean;
  formField: boolean;
  codeEditor: boolean;
  /** Fitted zoom and pan. Rotation alone does not count as leaving the fit. */
  atFit: boolean;
};

export type PresentationAction =
  | { type: "ignore" }
  | { type: "start" }
  /** Already presenting: swallow F5 / Mod-Shift-Enter so the browser does not reload. */
  | { type: "suppress" }
  /** Plain arrows at the fitted view. Phase 2 uses these for the next diagram. */
  | { type: "reserved" }
  | { type: "exit" }
  | { type: "pan"; dx: number; dy: number }
  | { type: "zoom"; factor: number }
  | { type: "rotate"; degrees: number }
  | { type: "reset" };

const FORM_SELECTOR = "input, textarea, select, [contenteditable='true']";

export function targetKind(info: TargetInfo | null): TargetKind {
  if (!info) return "other";
  if (info.closest(".cm-editor")) return "editor";
  const tag = info.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return "form";
  if (info.isContentEditable) return "form";
  if (info.closest(FORM_SELECTOR)) return "form";
  return "other";
}

export function isFormField(target: EventTarget | null): boolean {
  return targetKind(targetInfo(target)) === "form";
}

export function isCodeEditorTarget(target: EventTarget | null): boolean {
  return targetKind(targetInfo(target)) === "editor";
}

function targetInfo(target: EventTarget | null): TargetInfo | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  return {
    tagName: target.tagName,
    isContentEditable: target instanceof HTMLElement ? target.isContentEditable : false,
    closest: (selector) => Boolean(target.closest(selector)),
  };
}

export function keyEventFrom(event: KeyEvent): KeyEvent {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    composing: event.composing ?? false,
  };
}

function hasCommandMod(event: KeyEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

/** Plain F5. Ctrl/Cmd/Alt+F5 stays a browser reload. */
export function isPresentKey(event: KeyEvent): boolean {
  return event.key === "F5" && !hasCommandMod(event) && !event.shiftKey;
}

/** Ctrl+Shift+Enter or Cmd+Shift+Enter, without Alt. */
export function isPresentChord(event: KeyEvent): boolean {
  if (event.key !== "Enter" || !event.shiftKey || event.altKey) return false;
  return event.metaKey || event.ctrlKey;
}

export type WheelGesture = { type: "zoom"; factor: number } | { type: "pan"; dx: number; dy: number };

function clampWheelFactor(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(4, Math.max(0.25, factor));
}

/**
 * Pinch (ctrl/meta + wheel) and a mouse wheel zoom toward the pointer.
 * A trackpad two-finger scroll is a pixel-mode wheel with a horizontal
 * component or a fractional delta, and pans instead.
 * deltaMode: 0 pixel, 1 line, 2 page.
 */
export function wheelGesture(event: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
}): WheelGesture {
  if (event.ctrlKey || event.metaKey) {
    return { type: "zoom", factor: clampWheelFactor(Math.exp(-event.deltaY * 0.01)) };
  }
  const trackpad = event.deltaMode === 0 && (event.deltaX !== 0 || !Number.isInteger(event.deltaY));
  if (trackpad) return { type: "pan", dx: -event.deltaX, dy: -event.deltaY };
  const lines =
    event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * 16 : event.deltaY / 100;
  return { type: "zoom", factor: clampWheelFactor(Math.exp(-lines * 0.22)) };
}

function panFor(key: string): { dx: number; dy: number } | null {
  switch (key.toLowerCase()) {
    case "arrowup":
    case "w":
      return { dx: 0, dy: PAN_STEP };
    case "arrowdown":
    case "s":
      return { dx: 0, dy: -PAN_STEP };
    case "arrowleft":
    case "a":
      return { dx: PAN_STEP, dy: 0 };
    case "arrowright":
    case "d":
      return { dx: -PAN_STEP, dy: 0 };
    default:
      return null;
  }
}

function isArrow(key: string): boolean {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

export function presentationAction(event: KeyEvent, ctx: KeyContext): PresentationAction {
  if (event.composing) return { type: "ignore" };
  if (ctx.formField) return { type: "ignore" };

  const start = isPresentKey(event) || isPresentChord(event);
  if (start) {
    if (event.repeat || !ctx.available) return { type: "ignore" };
    if (ctx.presenting) return { type: "suppress" };
    return { type: "start" };
  }

  if (!ctx.presenting || ctx.codeEditor) return { type: "ignore" };
  if (hasCommandMod(event)) return { type: "ignore" };

  if (event.key === "Escape") {
    if (event.repeat) return { type: "ignore" };
    return { type: "exit" };
  }

  if (event.key === "0" || event.key === "Numpad0" || event.key.toLowerCase() === "f") {
    if (event.repeat || event.shiftKey) return { type: "ignore" };
    return { type: "reset" };
  }

  if (event.key.toLowerCase() === "r") {
    if (event.repeat) return { type: "ignore" };
    return { type: "rotate", degrees: event.shiftKey ? -90 : 90 };
  }

  if (event.key === "+" || event.key === "=" || event.key === "Add") {
    return { type: "zoom", factor: ZOOM_STEP };
  }
  if (event.key === "-" || event.key === "Subtract") {
    if (event.shiftKey && event.key === "-") return { type: "ignore" };
    return { type: "zoom", factor: 1 / ZOOM_STEP };
  }

  const pan = panFor(event.key);
  if (!pan) return { type: "ignore" };
  const letter = event.key.length === 1;
  if (letter && event.shiftKey) return { type: "ignore" };
  if (isArrow(event.key) && !event.shiftKey && ctx.atFit) return { type: "reserved" };
  return { type: "pan", ...pan };
}
