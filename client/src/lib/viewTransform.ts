/**
 * Camera math for presentation mode.
 *
 * The diagram stays an SVG. This module only describes how to place it:
 * pan (`x`, `y` in viewport pixels from the center), zoom (`scale`, where 1
 * is the SVG's own size), and rotation in degrees (clockwise, any angle).
 *
 * Screen position of a point measured from the diagram center:
 *   screen = rotate(scale * point) + (x, y)
 * CSS applies that as
 *   translate(x, y) rotate(deg) scale(s) translate(-width/2, -height/2)
 * on an element whose top-left sits on the viewport center and whose
 * transform-origin is 0 0.
 *
 * Slideshow navigation can reuse `isFitted`: arrow keys pan only when the
 * camera has left the fitted view. `fit` already uses the rotated bounding
 * box, so a later slide change can call `resetView` or `fit` per diagram.
 */

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** Keyboard and button zoom step. Wheel zoom uses a continuous factor. */
export const ZOOM_STEP = 1.2;
/** Keyboard pan distance in viewport pixels. */
export const PAN_STEP = 48;
/** Gap kept around a fitted diagram, capped so a small window still fits. */
export const FIT_PADDING = 48;

export type Point = { x: number; y: number };

export type Size = { width: number; height: number };

export type ViewTransform = {
  x: number;
  y: number;
  scale: number;
  /** Degrees clockwise. Arbitrary angles are valid; R steps by 90. */
  rotation: number;
};

export type ZoomLimits = { min: number; max: number };

export function identityView(): ViewTransform {
  return { x: 0, y: 0, scale: 1, rotation: 0 };
}

export function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Absolute sine and cosine. Right angles are exact so 90/270 fit is stable. */
function axisSinCos(rotation: number): { sin: number; cos: number } {
  const turns = normalizeDegrees(rotation) / 90;
  const nearest = Math.round(turns);
  if (Math.abs(turns - nearest) < 1e-6) {
    return nearest % 2 === 0 ? { sin: 0, cos: 1 } : { sin: 1, cos: 0 };
  }
  const rad = (normalizeDegrees(rotation) * Math.PI) / 180;
  return { sin: Math.abs(Math.sin(rad)), cos: Math.abs(Math.cos(rad)) };
}

/** Axis-aligned size of `content` after `rotation` degrees clockwise. */
export function rotatedContentSize(content: Size, rotation: number): Size {
  const { sin, cos } = axisSinCos(rotation);
  return {
    width: content.width * cos + content.height * sin,
    height: content.width * sin + content.height * cos,
  };
}

/**
 * Largest scale that fits the rotated diagram in the viewport, centered.
 * Scale is not clamped to MIN_ZOOM / MAX_ZOOM: Fit must show the whole
 * diagram, including one that is much larger or smaller than the screen.
 * Interactive zoom uses `zoomAt` limits that expand to include this scale.
 */
export function fit(viewport: Size, content: Size, rotation: number): ViewTransform {
  const bounds = rotatedContentSize(content, rotation);
  const pad = Math.min(
    FIT_PADDING,
    Math.max(0, viewport.width * 0.06),
    Math.max(0, viewport.height * 0.06),
  );
  const availW = Math.max(1, viewport.width - pad * 2);
  const availH = Math.max(1, viewport.height - pad * 2);
  const scale = Math.min(availW / Math.max(bounds.width, 1e-6), availH / Math.max(bounds.height, 1e-6));
  return {
    x: 0,
    y: 0,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    rotation: normalizeDegrees(rotation),
  };
}

/** Clears zoom, pan, and rotation, then fits the upright diagram. */
export function resetView(viewport: Size, content: Size): ViewTransform {
  return fit(viewport, content, 0);
}

export function viewsClose(a: ViewTransform, b: ViewTransform, panEpsilon = 0.75): boolean {
  const scaleEpsilon = Math.max(1e-4, Math.abs(b.scale) * 1e-3);
  return (
    Math.abs(a.x - b.x) <= panEpsilon &&
    Math.abs(a.y - b.y) <= panEpsilon &&
    Math.abs(a.scale - b.scale) <= scaleEpsilon &&
    Math.abs(normalizeDegrees(a.rotation) - normalizeDegrees(b.rotation)) < 0.05
  );
}

/** True when pan is centered and scale matches a fit at the current rotation. */
export function isFitted(view: ViewTransform, viewport: Size, content: Size): boolean {
  return viewsClose(view, fit(viewport, content, view.rotation));
}

export function defaultZoomLimits(fitScale: number): ZoomLimits {
  return {
    min: Math.min(MIN_ZOOM, fitScale),
    max: Math.max(MAX_ZOOM, fitScale),
  };
}

export function clampZoom(scale: number, limits: ZoomLimits = { min: MIN_ZOOM, max: MAX_ZOOM }): number {
  if (!Number.isFinite(scale)) return limits.min;
  return Math.min(limits.max, Math.max(limits.min, scale));
}

/**
 * Zoom by `factor` while keeping the diagram point under `focal` fixed.
 * `focal` is in viewport pixels relative to the viewport center.
 */
export function zoomAt(
  view: ViewTransform,
  focal: Point,
  factor: number,
  limits?: ZoomLimits,
): ViewTransform {
  if (!Number.isFinite(factor) || factor <= 0 || view.scale <= 0) return view;
  const nextScale = clampZoom(view.scale * factor, limits);
  const k = nextScale / view.scale;
  if (k === 1) return { ...view, scale: nextScale };
  return {
    ...view,
    scale: nextScale,
    x: focal.x * (1 - k) + view.x * k,
    y: focal.y * (1 - k) + view.y * k,
  };
}

export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/**
 * Adds `degrees`. When the camera is still fitted, the result is fitted at
 * the new angle so a tall diagram fills a landscape screen after a quarter turn.
 * A zoomed or panned camera keeps its scale and pan and only changes angle.
 */
export function rotateView(
  view: ViewTransform,
  degrees: number,
  viewport: Size | null,
  content: Size | null,
): ViewTransform {
  const rotation = normalizeDegrees(view.rotation + degrees);
  if (viewport && content && isFitted(view, viewport, content)) {
    return fit(viewport, content, rotation);
  }
  return { ...view, rotation };
}

/** Diagram-center point currently under a viewport-center-relative screen point. */
export function screenToContent(view: ViewTransform, screen: Point): Point {
  const dx = screen.x - view.x;
  const dy = screen.y - view.y;
  const rad = (-normalizeDegrees(view.rotation) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: (dx * cos - dy * sin) / view.scale,
    y: (dx * sin + dy * cos) / view.scale,
  };
}

export function cssTransform(view: ViewTransform, content: Size): string {
  const ox = -content.width / 2;
  const oy = -content.height / 2;
  return `translate(${view.x}px, ${view.y}px) rotate(${view.rotation}deg) scale(${view.scale}) translate(${ox}px, ${oy}px)`;
}

export function pointerAngle(point: Point): number {
  return (Math.atan2(point.y, point.x) * 180) / Math.PI;
}

/** Shortest signed turn from `from` to `to`, in degrees. */
export function rotationDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function pinchUpdate(
  previous: { distance: number; midpoint: Point },
  next: { distance: number; midpoint: Point },
): { factor: number; panX: number; panY: number } {
  const factor = previous.distance > 0 ? next.distance / previous.distance : 1;
  return {
    factor: Number.isFinite(factor) && factor > 0 ? factor : 1,
    panX: next.midpoint.x - previous.midpoint.x,
    panY: next.midpoint.y - previous.midpoint.y,
  };
}
