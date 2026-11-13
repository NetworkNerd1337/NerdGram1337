import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultZoomLimits,
  fit,
  identityView,
  isFitted,
  normalizeDegrees,
  panBy,
  resetView,
  rotateView,
  viewsClose,
  zoomAt,
  type Point,
  type Size,
  type ViewTransform,
} from "../lib/viewTransform";

/**
 * Presentation camera. Resize, orientation, and content-size changes re-fit
 * only while the user is still on the fitted view for the previous size.
 * A source refresh that does not change that fit leaves pan, zoom, and rotation.
 */
export function useDiagramView(viewport: Size | null, content: Size | null) {
  const [view, setView] = useState<ViewTransform>(identityView);
  const viewRef = useRef(view);
  const fittedBaseline = useRef<ViewTransform | null>(null);
  const viewportRef = useRef<Size | null>(null);
  const contentRef = useRef<Size | null>(null);

  const vw = viewport?.width ?? 0;
  const vh = viewport?.height ?? 0;
  const cw = content?.width ?? 0;
  const ch = content?.height ?? 0;
  const ready = vw > 0 && vh > 0 && cw > 0 && ch > 0;

  const commit = useCallback((next: ViewTransform) => {
    viewRef.current = next;
    const vp = viewportRef.current;
    const ct = contentRef.current;
    const fitted = Boolean(vp && ct && isFitted(next, vp, ct));
    if (fitted) fittedBaseline.current = next;
    setView(next);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const nextViewport = { width: vw, height: vh };
    const nextContent = { width: cw, height: ch };
    viewportRef.current = nextViewport;
    contentRef.current = nextContent;
    const current = viewRef.current;
    const baseline = fittedBaseline.current;
    if (baseline && !viewsClose(current, baseline)) return;
    const next = fit(nextViewport, nextContent, baseline ? current.rotation : 0);
    fittedBaseline.current = next;
    if (viewsClose(current, next)) {
      viewRef.current = next;
      return;
    }
    viewRef.current = next;
    setView(next);
  }, [ready, vw, vh, cw, ch]);

  const limitsFor = useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    const fitScale =
      vp && ct ? fit(vp, ct, viewRef.current.rotation).scale : viewRef.current.scale;
    return defaultZoomLimits(fitScale);
  }, []);

  const zoomAtPoint = useCallback(
    (focal: Point, factor: number) => {
      commit(zoomAt(viewRef.current, focal, factor, limitsFor()));
    },
    [commit, limitsFor],
  );

  const pan = useCallback(
    (dx: number, dy: number) => {
      commit(panBy(viewRef.current, dx, dy));
    },
    [commit],
  );

  const rotate = useCallback(
    (degrees: number) => {
      commit(rotateView(viewRef.current, degrees, viewportRef.current, contentRef.current));
    },
    [commit],
  );

  const rotateFree = useCallback(
    (degrees: number) => {
      if (!degrees) return;
      const current = viewRef.current;
      commit({ ...current, rotation: normalizeDegrees(current.rotation + degrees) });
    },
    [commit],
  );

  const reset = useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return;
    commit(resetView(vp, ct));
  }, [commit]);

  const atFit = Boolean(viewport && content && isFitted(view, viewport, content));

  const isAtFit = useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return true;
    return isFitted(viewRef.current, vp, ct);
  }, []);

  return { view, atFit, isAtFit, zoomAtPoint, pan, rotate, rotateFree, reset };
}
