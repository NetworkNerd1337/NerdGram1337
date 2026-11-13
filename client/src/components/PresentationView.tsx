import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useDiagramView } from "../hooks/useDiagramView";
import { diagramHeading, FALLBACK_THEME, parseDiagram } from "../lib/frontMatter";
import { renderMermaid } from "../lib/mermaidRender";
import {
  currentFullscreen,
  exitPresentationFullscreen,
  PRESENTATION_ROOT_ID,
  requestPresentationFullscreen,
} from "../lib/presentationFullscreen";
import {
  isCodeEditorTarget,
  isFormField,
  keyEventFrom,
  presentationAction,
  wheelGesture,
  type PresentationAction,
} from "../lib/presentationKeys";
import { backgroundFromSvg, themeBackground } from "../lib/svgBackground";
import {
  cssTransform,
  pinchUpdate,
  pointerAngle,
  rotationDelta,
  ZOOM_STEP,
  type Point,
  type Size,
} from "../lib/viewTransform";

const CONTROL_IDLE_MS = 2500;

export type PresentationViewProps = {
  /** Null while a file read is still in flight. */
  source: string | null;
  path: string;
  fileError?: string | null;
  onExit: () => void;
};

function readSvgSize(svg: SVGSVGElement): Size | null {
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height };
  const widthAttr = svg.getAttribute("width") ?? "";
  const heightAttr = svg.getAttribute("height") ?? "";
  const width = Number.parseFloat(widthAttr);
  const height = Number.parseFloat(heightAttr);
  if (width > 0 && height > 0 && !widthAttr.includes("%") && !heightAttr.includes("%")) {
    return { width, height };
  }
  try {
    const bounds = svg.getBBox();
    if (bounds.width > 0 && bounds.height > 0) return { width: bounds.width, height: bounds.height };
  } catch {
    return null;
  }
  return null;
}

function useStageSize(stage: React.RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) =>
        prev && Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    const visual = window.visualViewport;
    visual?.addEventListener("resize", measure);
    let media: MediaQueryList | null = null;
    const onResolution = () => {
      measure();
      media?.removeEventListener("change", onResolution);
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener("change", onResolution);
    };
    try {
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener("change", onResolution);
    } catch {
      media = null;
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      visual?.removeEventListener("resize", measure);
      media?.removeEventListener("change", onResolution);
    };
  }, [stage]);
  return size;
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, select, textarea")];
}

export function PresentationView({ source, path, fileError = null, onExit }: PresentationViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  const engaged = useRef(false);
  const lastFocal = useRef<Point>({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<
    | { kind: "none" }
    | { kind: "pan"; id: number; last: Point }
    | { kind: "rotate"; id: number; lastAngle: number }
    | { kind: "pinch"; distance: number; midpoint: Point }
  >({ kind: "none" });
  const overBar = useRef(false);
  const dragging = useRef(false);
  const idleTimer = useRef(0);
  const barVisibleRef = useRef(true);
  const idleRef = useRef(false);
  const hadSvg = useRef(false);

  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [content, setContent] = useState<Size | null>(null);
  const [titleOn, setTitleOn] = useState(true);
  const [barVisible, setBarVisible] = useState(true);
  const [idle, setIdle] = useState(false);
  const [nativeFs, setNativeFs] = useState(false);
  const [panning, setPanning] = useState(false);

  const viewport = useStageSize(stageRef);
  const camera = useDiagramView(viewport, content);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  onExitRef.current = onExit;

  const parsed = useMemo(() => (source == null ? null : parseDiagram(source)), [source]);
  const heading = diagramHeading(parsed?.title, path || "diagram");
  const effectiveTheme = parsed?.malformed ? FALLBACK_THEME : (parsed?.theme ?? FALLBACK_THEME);
  const background =
    backgroundFromSvg(svg) ??
    themeBackground(effectiveTheme, parsed?.themeVariables ?? null) ??
    themeBackground(FALLBACK_THEME) ??
    "#333333";

  const notices: string[] = [];
  if (fileError) notices.push(fileError);
  if (parsed?.malformed) {
    notices.push(
      parsed.error
        ? `The YAML header could not be parsed: ${parsed.error}`
        : "The YAML header could not be parsed.",
    );
  }
  if (renderError) notices.push(renderError);
  if (source != null && !source.trim() && !fileError) notices.push("This diagram has nothing to show.");
  const notice = notices.join(" ");

  useEffect(() => {
    hadSvg.current = false;
    setSvg("");
    setRenderError(null);
    setContent(null);
  }, [path]);

  useEffect(() => {
    if (source == null) return;
    let cancelled = false;
    const delay = hadSvg.current ? 280 : 0;
    const timer = window.setTimeout(() => {
      const parsedSource = parseDiagram(source);
      const text = parsedSource.malformed ? parsedSource.body : source;
      if (!text.trim()) {
        if (!cancelled) setRenderError(null);
        return;
      }
      void renderMermaid(text, FALLBACK_THEME).then(
        (result) => {
          if (cancelled) return;
          hadSvg.current = true;
          setSvg(result.svg);
          setRenderError(null);
        },
        (err: unknown) => {
          if (cancelled) return;
          setRenderError(err instanceof Error ? err.message : "Could not render this diagram");
        },
      );
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source]);

  useLayoutEffect(() => {
    const node = canvasRef.current?.querySelector("svg");
    if (!(node instanceof SVGSVGElement)) return;
    const next = readSvgSize(node);
    if (!next) return;
    setContent((prev) =>
      prev && prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, [svg]);

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      previous?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.dataset.presenting = "true";
    document.body.style.overflow = "hidden";
    return () => {
      delete document.body.dataset.presenting;
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    let cancelled = false;
    const onChange = () => {
      if (cancelled) return;
      const active = currentFullscreen() === element && element.isConnected;
      setNativeFs(active);
      if (engaged.current && element.isConnected && currentFullscreen() !== element) {
        engaged.current = false;
        onExitRef.current();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    void requestPresentationFullscreen().then((ok) => {
      if (cancelled) return;
      engaged.current = ok && currentFullscreen() === element;
      setNativeFs(engaged.current);
    });
    return () => {
      cancelled = true;
      engaged.current = false;
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const revealBar = () => {
    window.clearTimeout(idleTimer.current);
    if (!barVisibleRef.current || idleRef.current) {
      barVisibleRef.current = true;
      idleRef.current = false;
      setBarVisible(true);
      setIdle(false);
    }
    idleTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      const keep =
        dragging.current ||
        overBar.current ||
        (active instanceof Node && Boolean(barRef.current?.contains(active)));
      if (keep) {
        revealBar();
        return;
      }
      barVisibleRef.current = false;
      idleRef.current = true;
      setBarVisible(false);
      setIdle(true);
    }, CONTROL_IDLE_MS);
  };

  useEffect(() => {
    revealBar();
    return () => window.clearTimeout(idleTimer.current);
    // The idle clock starts once. Later pointer and key handlers call revealBar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = presentationAction(keyEventFrom(event), {
        presenting: true,
        available: true,
        formField: isFormField(event.target),
        codeEditor: isCodeEditorTarget(event.target),
        atFit: cameraRef.current.isAtFit(),
      });
      if (action.type === "ignore") return;
      if (action.type === "exit") {
        event.preventDefault();
        event.stopPropagation();
        leave();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      applyAction(action);
      revealBar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // leave and applyAction close over refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const stage = stageRef.current;
      const rect = stage?.getBoundingClientRect();
      const focal = rect
        ? {
            x: event.clientX - rect.left - rect.width / 2,
            y: event.clientY - rect.top - rect.height / 2,
          }
        : lastFocal.current;
      lastFocal.current = focal;
      const gestureEvent = wheelGesture(event);
      if (gestureEvent.type === "zoom") cameraRef.current.zoomAtPoint(focal, gestureEvent.factor);
      else cameraRef.current.pan(gestureEvent.dx, gestureEvent.dy);
      revealBar();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyAction(action: PresentationAction) {
    const api = cameraRef.current;
    if (action.type === "pan") api.pan(action.dx, action.dy);
    else if (action.type === "zoom") api.zoomAtPoint(lastFocal.current, action.factor);
    else if (action.type === "rotate") api.rotate(action.degrees);
    else if (action.type === "reset") api.reset();
  }

  function leave() {
    engaged.current = false;
    void exitPresentationFullscreen();
    onExitRef.current();
  }

  function enterFullscreen() {
    void requestPresentationFullscreen({ force: true }).then((ok) => {
      const element = rootRef.current;
      engaged.current = ok && element != null && currentFullscreen() === element;
      setNativeFs(engaged.current);
    });
  }

  function stagePoint(event: { clientX: number; clientY: number }): Point {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const point = stagePoint(event);
    lastFocal.current = point;
    pointers.current.set(event.pointerId, point);
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size >= 2) {
      const info = pairInfo();
      if (info) gesture.current = { kind: "pinch", ...info };
      return;
    }
    if (event.altKey) {
      gesture.current = { kind: "rotate", id: event.pointerId, lastAngle: pointerAngle(point) };
    } else {
      gesture.current = { kind: "pan", id: event.pointerId, last: point };
      setPanning(true);
    }
    revealBar();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) {
      revealBar();
      return;
    }
    const point = stagePoint(event);
    pointers.current.set(event.pointerId, point);
    lastFocal.current = point;
    const current = gesture.current;
    if (current.kind === "pinch") {
      const info = pairInfo();
      if (!info) return;
      const update = pinchUpdate(current, info);
      cameraRef.current.zoomAtPoint(info.midpoint, update.factor);
      cameraRef.current.pan(update.panX, update.panY);
      gesture.current = { kind: "pinch", ...info };
      return;
    }
    if (current.kind === "rotate" && current.id === event.pointerId) {
      const angle = pointerAngle(point);
      cameraRef.current.rotateFree(rotationDelta(current.lastAngle, angle));
      current.lastAngle = angle;
      return;
    }
    if (current.kind === "pan" && current.id === event.pointerId) {
      cameraRef.current.pan(point.x - current.last.x, point.y - current.last.y);
      current.last = point;
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = { kind: "none" };
      dragging.current = false;
      setPanning(false);
      revealBar();
      return;
    }
    if (pointers.current.size === 1) {
      const entry = pointers.current.entries().next().value as [number, Point] | undefined;
      if (entry) gesture.current = { kind: "pan", id: entry[0], last: entry[1] };
    }
  }

  function pairInfo(): { distance: number; midpoint: Point } | null {
    const points = [...pointers.current.values()];
    if (points.length < 2) return null;
    const [a, b] = points;
    if (!a || !b) return null;
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  function onTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const root = rootRef.current;
    if (!root) return;
    const items = focusable(root);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    const next =
      index < 0
        ? event.shiftKey
          ? items[items.length - 1]
          : items[0]
        : items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length];
    next?.focus();
    revealBar();
  }

  const pct = Math.round(camera.view.scale * 100);
  const revealed =
    content != null &&
    viewport != null &&
    (camera.atFit || camera.view.x !== 0 || camera.view.y !== 0 || camera.view.rotation !== 0 || camera.view.scale !== 1);
  const showStatus = !svg && !notice;
  const status = source == null ? "Loading diagram…" : "Rendering diagram…";

  return createPortal(
    <div
      id={PRESENTATION_ROOT_ID}
      ref={rootRef}
      className={`presentation${idle ? " is-idle" : ""}${nativeFs ? " is-fullscreen" : " is-overlay"}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Presentation: ${heading}`}
      tabIndex={-1}
      style={{ background }}
      onKeyDown={onTab}
    >
      <div
        ref={stageRef}
        className={`presentation-stage${panning ? " is-panning" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {svg ? (
          <div
            ref={canvasRef}
            className="presentation-canvas"
            style={
              content
                ? {
                    width: content.width,
                    height: content.height,
                    transform: cssTransform(camera.view, content),
                    visibility: revealed ? "visible" : "hidden",
                  }
                : { visibility: "hidden" }
            }
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}
        {titleOn ? <div className="presentation-title">{heading}</div> : null}
        {notice ? (
          <div className={`presentation-banner${svg ? "" : " is-only"}`} role="alert">
            {notice}
          </div>
        ) : null}
        {showStatus ? <div className="presentation-status">{status}</div> : null}
      </div>
      <div
        ref={barRef}
        className={`presentation-bar${barVisible ? " is-visible" : ""}`}
        onPointerEnter={() => {
          overBar.current = true;
          revealBar();
        }}
        onPointerLeave={() => {
          overBar.current = false;
          revealBar();
        }}
        onFocus={() => revealBar()}
      >
        <button type="button" className="btn" aria-label="Zoom out" onClick={() => camera.zoomAtPoint(lastFocal.current, 1 / ZOOM_STEP)}>
          −
        </button>
        <span className="presentation-zoom" aria-label={`Zoom ${pct}%`}>
          {pct}%
        </span>
        <button type="button" className="btn" aria-label="Zoom in" onClick={() => camera.zoomAtPoint(lastFocal.current, ZOOM_STEP)}>
          +
        </button>
        <button type="button" className="btn" aria-label="Rotate left" onClick={() => camera.rotate(-90)}>
          ↺
        </button>
        <button type="button" className="btn" aria-label="Rotate right" onClick={() => camera.rotate(90)}>
          ↻
        </button>
        <button type="button" className="btn" aria-label="Fit to screen" onClick={() => camera.reset()}>
          Fit
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={titleOn}
          aria-label={titleOn ? "Hide title" : "Show title"}
          onClick={() => setTitleOn((current) => !current)}
        >
          Title
        </button>
        {nativeFs ? null : (
          <button type="button" className="btn" aria-label="Enter full screen" onClick={() => void enterFullscreen()}>
            Full screen
          </button>
        )}
        <button type="button" className="btn" aria-label="Exit presentation" onClick={leave}>
          Exit
        </button>
      </div>
    </div>,
    document.body,
  );
}
