import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  cssTransform,
  fit,
  identityView,
  isFitted,
  panBy,
  pinchUpdate,
  resetView,
  rotateView,
  rotatedContentSize,
  screenToContent,
  zoomAt,
  type Size,
  type ViewTransform,
} from "../src/lib/viewTransform";

const viewport: Size = { width: 1000, height: 500 };
const tall: Size = { width: 200, height: 800 };
const wide: Size = { width: 800, height: 200 };

function expectSamePoint(
  view: ViewTransform,
  next: ViewTransform,
  focal: { x: number; y: number },
) {
  const before = screenToContent(view, focal);
  const after = screenToContent(next, focal);
  expect(after.x).toBeCloseTo(before.x, 6);
  expect(after.y).toBeCloseTo(before.y, 6);
}

describe("view transform", () => {
  it("zooms toward a point and leaves the center alone when the focal point is the center", () => {
    const start = identityView();
    const center = zoomAt(start, { x: 0, y: 0 }, 2);
    expect(center).toMatchObject({ x: 0, y: 0, scale: 2, rotation: 0 });

    const corner = zoomAt(start, { x: 100, y: -40 }, 2);
    expect(corner.scale).toBe(2);
    expect(corner.x).not.toBe(0);
    expect(corner.y).not.toBe(0);
    expectSamePoint(start, corner, { x: 100, y: -40 });
  });

  it("keeps the focal point fixed while rotated", () => {
    const start: ViewTransform = { x: 12, y: -30, scale: 1.5, rotation: 35 };
    const focal = { x: 80, y: 25 };
    const next = zoomAt(start, focal, 1.4);
    expectSamePoint(start, next, focal);
    expect(next.rotation).toBe(35);
  });

  it("clamps interactive zoom to the documented limits", () => {
    const huge = zoomAt({ ...identityView(), scale: MAX_ZOOM }, { x: 10, y: 10 }, 10);
    expect(huge.scale).toBe(MAX_ZOOM);
    expect(huge.x).toBe(0);
    const tiny = zoomAt({ ...identityView(), scale: MIN_ZOOM }, { x: 0, y: 0 }, 0.01);
    expect(tiny.scale).toBe(MIN_ZOOM);
    const custom = zoomAt(identityView(), { x: 0, y: 0 }, 0.01, { min: 0.02, max: 20 });
    expect(custom.scale).toBe(0.02);
    expect(zoomAt(identityView(), { x: 0, y: 0 }, 0)).toEqual(identityView());
  });

  it("pans in each direction", () => {
    let view = identityView();
    view = panBy(view, 15, 0);
    expect(view.x).toBe(15);
    view = panBy(view, -15, 0);
    expect(view.x).toBe(0);
    view = panBy(view, 0, 8);
    expect(view.y).toBe(8);
    view = panBy(view, 0, -8);
    expect(view.y).toBe(0);
  });

  it("steps rotation by 90 degrees and wraps", () => {
    let view = identityView();
    view = rotateView(view, 90, null, null);
    expect(view.rotation).toBe(90);
    view = rotateView(view, 90, null, null);
    expect(view.rotation).toBe(180);
    view = rotateView(view, 90, null, null);
    expect(view.rotation).toBe(270);
    view = rotateView(view, 90, null, null);
    expect(view.rotation).toBe(0);
    expect(rotateView(identityView(), -90, null, null).rotation).toBe(270);
  });

  it("fits a tall diagram to a landscape viewport, and larger after a quarter turn", () => {
    const upright = fit(viewport, tall, 0);
    const turned = fit(viewport, tall, 90);
    const turnedBack = fit(viewport, tall, 270);
    expect(upright.x).toBe(0);
    expect(upright.y).toBe(0);
    expect(upright.rotation).toBe(0);
    expect(rotatedContentSize(tall, 0)).toEqual({ width: 200, height: 800 });
    expect(rotatedContentSize(tall, 90)).toEqual({ width: 800, height: 200 });
    expect(rotatedContentSize(tall, 270)).toEqual({ width: 800, height: 200 });
    expect(upright.scale * 800).toBeLessThanOrEqual(viewport.height);
    expect(upright.scale * 200).toBeLessThanOrEqual(viewport.width);
    expect(turned.scale).toBeGreaterThan(upright.scale);
    expect(turned.scale).toBeCloseTo(turnedBack.scale);
    expect(turned.scale * 800).toBeLessThanOrEqual(viewport.width);
    expect(turned.scale * 200).toBeLessThanOrEqual(viewport.height);
    expect(isFitted(upright, viewport, tall)).toBe(true);
    expect(isFitted(turned, viewport, tall)).toBe(true);
  });

  it("fits a wide diagram to a portrait viewport after rotation", () => {
    const portrait = { width: 500, height: 1000 };
    const upright = fit(portrait, wide, 0);
    const turned = fit(portrait, wide, 90);
    expect(turned.scale).toBeGreaterThan(upright.scale);
    expect(turned.scale * 800).toBeLessThanOrEqual(portrait.height);
    expect(turned.scale * 200).toBeLessThanOrEqual(portrait.width);
  });

  it("re-fits a quarter turn only when the camera was already fitted", () => {
    const fitted = fit(viewport, tall, 0);
    const turned = rotateView(fitted, 90, viewport, tall);
    expect(turned.rotation).toBe(90);
    expect(isFitted(turned, viewport, tall)).toBe(true);
    expect(turned.scale).toBeCloseTo(fit(viewport, tall, 90).scale);

    const zoomed: ViewTransform = { ...fitted, scale: fitted.scale * 2, x: 40, y: -12 };
    const kept = rotateView(zoomed, 90, viewport, tall);
    expect(kept.scale).toBe(zoomed.scale);
    expect(kept.x).toBe(40);
    expect(kept.y).toBe(-12);
    expect(kept.rotation).toBe(90);
    expect(isFitted(kept, viewport, tall)).toBe(false);
  });

  it("resets zoom, pan, and rotation", () => {
    const messy: ViewTransform = { x: 80, y: -20, scale: 4, rotation: 90 };
    const next = resetView(viewport, tall);
    expect(next.rotation).toBe(0);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
    expect(next.scale).toBeCloseTo(fit(viewport, tall, 0).scale);
    expect(isFitted(next, viewport, tall)).toBe(true);
    expect(isFitted(messy, viewport, tall)).toBe(false);
    expect(cssTransform(next, tall)).toContain("rotate(0deg)");
    expect(cssTransform(next, tall)).toContain("scale(");
    expect(cssTransform(messy, tall)).toContain("translate(80px, -20px)");
  });

  it("reports a pinch as a scale factor and a pan of the midpoint", () => {
    const update = pinchUpdate(
      { distance: 100, midpoint: { x: 0, y: 0 } },
      { distance: 150, midpoint: { x: 10, y: -4 } },
    );
    expect(update.factor).toBeCloseTo(1.5);
    expect(update.panX).toBe(10);
    expect(update.panY).toBe(-4);
  });
});
