import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { indexDiagramLinks, insertDiagramLink, linksFor } from "../../../server/src/diagramLinks.ts";
import { ApiError, api } from "../api";
import { Brand } from "../components/Brand";
import { CommandsButton } from "../components/CommandPalette";
import { useCommandHost } from "../components/commandPaletteContext";
import { ConflictDialog } from "../components/ConflictDialog";
import { DiagramInfoPanel, type DiagramLinkRow } from "../components/DiagramInfoPanel";
import { DrillTrail } from "../components/DrillTrail";
import { LinkNodeDialog } from "../components/LinkNodeDialog";
import { EditorLockBanner, TakeoverDialog } from "../components/EditorLockBanner";
import { HistoryDialog } from "../components/HistoryDialog";
import { MermaidCodeEditor } from "../components/MermaidCodeEditor";
import { ProblemsPanel } from "../components/ProblemsPanel";
import { PresentationView } from "../components/PresentationView";
import { actionForClickTarget, clickTargetOnElement, openExternalLink } from "../lib/diagramClicks";
import { drillForward, drillIndex, trailFromState, withCrumbTitle } from "../lib/drillTrail";
import { getEditorView, revealEditorMatch, runFind, runGotoLine, runReplace } from "../lib/editorCommands";
import { extractNodeIds } from "../lib/mermaidCompletions";
import { applyLintFix } from "../lib/lintActions";
import type { ReportedDiagnostic } from "../lib/mermaidLint";
import { OTHER_WINDOW_NOTE, STILL_HELD_NOTE, releaseEditorLock } from "../lib/editorLock";
import { exportDiagram, type ExportFormat } from "../lib/exportDiagram";
import {
  cancelScheduledLockRelease,
  clearStoredLock,
  editorEpochIsCurrent,
  editorSessionId,
  nextEditorEpoch,
  readStoredLock,
  scheduleLockRelease,
  writeStoredLock,
} from "../lib/editorSession";
import {
  applyDiagramPatch,
  diagramHeading,
  FALLBACK_THEME,
  MERMAID_LAYOUTS,
  MERMAID_LOOKS,
  MERMAID_THEMES,
  migrateInitDirectives,
  parseDiagram,
  themeLabel,
  thumbnailCacheKey,
  type DiagramPatch,
} from "../lib/frontMatter";
import { renderMermaid } from "../lib/mermaidRender";
import { startPresentation } from "../lib/presentationFullscreen";
import {
  isCodeEditorTarget,
  isFormField,
  keyEventFrom,
  presentationAction,
} from "../lib/presentationKeys";
import { rememberThumbnail } from "../lib/thumbnailCache";
import { displayName, joinPath, parentPath } from "../lib/paths";
import type { TreeNode } from "../types";

type Access = "loading" | "edit" | "readonly";

type Baseline = {
  mtimeMs: number;
  hash: string;
};

type ConflictState = {
  mine: string;
  disk: string;
  diskMtimeMs: number;
  diskHash: string;
  open: boolean;
};

async function writeCopy(originalPath: string, content: string): Promise<string> {
  const parent = parentPath(originalPath);
  const base = displayName(originalPath);
  for (let n = 1; n < 50; n += 1) {
    const name = n === 1 ? `${base} (copy).mmd` : `${base} (copy ${n}).mmd`;
    const copyPath = joinPath(parent, name);
    try {
      await api.writeFile(copyPath, content);
      return copyPath;
    } catch (err) {
      if (err instanceof ApiError && (err.code === "exists" || err.code === "conflict")) continue;
      throw err;
    }
  }
  throw new Error("Could not find a free name for the copy");
}

export function EditorPage() {
  const params = useParams();
  const filePath = params["*"] || "";
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const infoOpen = searchParams.get("info") === "1";

  const [code, setCode] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [access, setAccess] = useState<Access>("loading");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [svgHtml, setSvgHtml] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ReportedDiagnostic[] | null>(null);
  const [diagramPaths, setDiagramPaths] = useState<string[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error" | "paused"
  >("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [lockNote, setLockNote] = useState<string | null>(null);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [linkMessage, setLinkMessage] = useState<{ path: string; text: string } | null>(null);
  const [linkNodeOpen, setLinkNodeOpen] = useState(false);
  const [linkedFrom, setLinkedFrom] = useState<{ path: string; target: string; line: number }[]>([]);
  const [presentPath, setPresentPath] = useState(filePath);
  if (presentPath !== filePath) {
    setPresentPath(filePath);
    setPresenting(false);
  }
  const [savedCode, setSavedCode] = useState("");
  const [lockToken, setLockToken] = useState<string | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef<{ source: string; svg: string } | null>(null);
  const renderGen = useRef(0);
  const renderTimer = useRef<number | null>(null);
  const skipNextSave = useRef(true);
  const baselineRef = useRef<Baseline | null>(null);
  const lockTokenRef = useRef<string | null>(null);
  const latestCodeRef = useRef("");
  const lastSavedRef = useRef("");
  const pathRef = useRef(filePath);
  const accessRef = useRef<Access>("loading");
  const conflictRef = useRef(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const heartbeatEveryRef = useRef(15_000);

  useEffect(() => {
    pathRef.current = filePath;
    latestCodeRef.current = code;
    accessRef.current = access;
    conflictRef.current = conflict != null;
    lockTokenRef.current = lockToken;
    lastSavedRef.current = savedCode;
  }, [filePath, code, access, conflict, lockToken, savedCode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const publishThumbnail = (file: string, source: string, svg: string) => {
    if (!svg || !source.trim() || source !== lastSavedRef.current) return;
    const key = thumbnailCacheKey(source);
    rememberThumbnail({
      path: file,
      cacheKey: key,
      mtimeMs: baselineRef.current?.mtimeMs ?? null,
      svg,
      status: "ready",
    });
    void api.saveThumbnail(file, key, svg).catch(() => undefined);
  };

  const flushSave = useCallback(async (scheduledPath: string) => {
    while (mountedRef.current && pathRef.current === scheduledPath) {
      if (savingRef.current) return;
      if (accessRef.current !== "edit" || conflictRef.current) return;
      const baseline = baselineRef.current;
      if (!baseline) return;
      const content = latestCodeRef.current;
      if (content === lastSavedRef.current) return;

      savingRef.current = true;
      if (mountedRef.current) setSaveState("saving");
      try {
        const result = await api.writeFile(scheduledPath, content, {
          expectedMtimeMs: baseline.mtimeMs,
          expectedHash: baseline.hash,
          lockToken: lockTokenRef.current,
        });
        if (!mountedRef.current || pathRef.current !== scheduledPath) return;
        baselineRef.current = { mtimeMs: result.mtimeMs, hash: result.hash };
        if (latestCodeRef.current === content) {
          lastSavedRef.current = content;
          setSavedCode(content);
          setSaveState("saved");
        }
        const rendered = renderedRef.current;
        if (rendered && rendered.source === content) {
          publishThumbnail(scheduledPath, content, rendered.svg);
        }
      } catch (err) {
        if (!mountedRef.current || pathRef.current !== scheduledPath) return;
        if (err instanceof ApiError && err.code === "conflict" && err.current) {
          conflictRef.current = true;
          setConflict({
            mine: content,
            disk: err.current.content,
            diskMtimeMs: err.current.mtimeMs,
            diskHash: err.current.hash,
            open: true,
          });
          setSaveState("paused");
          return;
        }
        if (err instanceof ApiError && err.code === "locked") {
          accessRef.current = "readonly";
          lockTokenRef.current = null;
          setLockToken(null);
          clearStoredLock(scheduledPath);
          setAccess("readonly");
          setLockNote("Another window took over this diagram. Autosave has stopped.");
          setSaveState("error");
          return;
        }
        if (err instanceof ApiError && err.code === "missing") {
          setLoadError("This diagram is no longer on disk. Your copy is still in the editor.");
          setSaveState("error");
          return;
        }
        setSaveState("error");
        return;
      } finally {
        savingRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    const epoch = nextEditorEpoch(filePath);
    let acquiredToken: string | null = null;
    skipNextSave.current = true;
    conflictRef.current = false;
    lockTokenRef.current = null;
    setLockToken(null);
    setSavedCode("");
    setLoaded(false);
    setAccess("loading");
    setConflict(null);
    setLockNote(null);
    setTakeoverOpen(false);
    setCopyNote(null);
    setHistoryOpen(false);
    setLoadError(null);
    setSaveState("idle");
    renderGen.current += 1;
    renderedRef.current = null;
    setSvgHtml("");
    setRenderError(null);
    setPreviewStale(false);
    setDiagnostics(null);
    cancelScheduledLockRelease(filePath);

    (async () => {
      if (!filePath) {
        setLoadError("Missing diagram path");
        return;
      }
      try {
        const file = await api.readFile(filePath);
        if (!editorEpochIsCurrent(filePath, epoch)) return;

        let editable = false;
        const sessionId = editorSessionId();
        const stored = readStoredLock(filePath);
        try {
          let lock =
            stored && stored.sessionId === sessionId
              ? await api.heartbeatLock(filePath, stored.token).catch(() => null)
              : null;
          if (!lock) lock = await api.acquireLock(filePath, sessionId);
          if (!editorEpochIsCurrent(filePath, epoch)) {
            const current = readStoredLock(filePath);
            if (current?.token !== lock.token) {
              void api.releaseLock(filePath, lock.token).catch(() => undefined);
            }
            return;
          }
          acquiredToken = lock.token;
          lockTokenRef.current = lock.token;
          setLockToken(lock.token);
          heartbeatEveryRef.current = lock.heartbeatEveryMs || 15_000;
          writeStoredLock(filePath, { token: lock.token, sessionId: lock.sessionId });
          editable = true;
        } catch (err) {
          if (!(err instanceof ApiError) || err.code !== "locked") throw err;
          if (!editorEpochIsCurrent(filePath, epoch)) return;
          setLockNote(OTHER_WINDOW_NOTE);
        }

        if (!editorEpochIsCurrent(filePath, epoch)) return;
        baselineRef.current = { mtimeMs: file.mtimeMs, hash: file.hash };
        lastSavedRef.current = file.content;
        setSavedCode(file.content);
        latestCodeRef.current = file.content;
        skipNextSave.current = true;
        setCode(file.content);
        setAccess(editable ? "edit" : "readonly");
        setLoaded(true);
      } catch (err) {
        if (!editorEpochIsCurrent(filePath, epoch)) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load");
        setLoaded(false);
      }
    })();

    return () => {
      const token = acquiredToken ?? lockTokenRef.current;
      if (!token) return;
      scheduleLockRelease(filePath, () => {
        clearStoredLock(filePath);
        if (lockTokenRef.current === token) lockTokenRef.current = null;
        releaseEditorLock(filePath, token);
      });
    };
  }, [filePath]);

  const revealedKey = useRef("");
  useEffect(() => {
    if (!loaded) return;
    const lineRaw = searchParams.get("line");
    const find = searchParams.get("find") ?? "";
    if (!lineRaw && !find) return;
    const lineNumber = lineRaw ? Number(lineRaw) : null;
    if (lineRaw && (!Number.isInteger(lineNumber) || (lineNumber ?? 0) < 1)) return;
    const key = `${filePath}|${lineRaw ?? ""}|${find}`;
    if (revealedKey.current === key) return;
    let attempts = 0;
    let timer = 0;
    const tick = () => {
      attempts += 1;
      if (revealEditorMatch(lineNumber, find)) {
        revealedKey.current = key;
        return;
      }
      if (attempts < 12) timer = window.setTimeout(tick, 40);
    };
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
  }, [loaded, filePath, searchParams]);

  useEffect(() => {
    if (access !== "edit") return;
    const onHide = () => {
      const token = lockTokenRef.current;
      if (!token) return;
      clearStoredLock(filePath);
      releaseEditorLock(filePath, token);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [access, filePath]);

  useEffect(() => {
    if (access !== "edit" || !loaded) return;
    const timer = window.setInterval(() => {
      const token = lockTokenRef.current;
      const currentPath = pathRef.current;
      if (!token || currentPath !== filePath) return;
      void api.heartbeatLock(currentPath, token).catch(async (err) => {
        if (!(err instanceof ApiError) || err.code !== "locked") return;
        if (pathRef.current !== currentPath) return;
        try {
          const lock = await api.acquireLock(currentPath, editorSessionId());
          if (pathRef.current !== currentPath) {
            void api.releaseLock(currentPath, lock.token).catch(() => undefined);
            return;
          }
          const disk = await api.readFile(currentPath);
          lockTokenRef.current = lock.token;
          setLockToken(lock.token);
          writeStoredLock(currentPath, { token: lock.token, sessionId: lock.sessionId });
          if (
            baselineRef.current &&
            disk.hash !== baselineRef.current.hash &&
            latestCodeRef.current !== disk.content
          ) {
            conflictRef.current = true;
            setConflict({
              mine: latestCodeRef.current,
              disk: disk.content,
              diskMtimeMs: disk.mtimeMs,
              diskHash: disk.hash,
              open: true,
            });
            setSaveState("paused");
            return;
          }
          baselineRef.current = { mtimeMs: disk.mtimeMs, hash: disk.hash };
        } catch {
          if (pathRef.current !== currentPath) return;
          lockTokenRef.current = null;
          setLockToken(null);
          clearStoredLock(currentPath);
          accessRef.current = "readonly";
          setAccess("readonly");
          setLockNote("Another window took over this diagram. Autosave has stopped.");
          setSaveState("error");
        }
      });
    }, heartbeatEveryRef.current);
    return () => window.clearInterval(timer);
  }, [access, filePath, loaded]);

  useEffect(() => {
    if (access !== "readonly" || !loaded) return;
    const timer = window.setInterval(() => {
      if (latestCodeRef.current !== lastSavedRef.current) return;
      void (async () => {
        try {
          const lock = await api.acquireLock(filePath, editorSessionId());
          if (pathRef.current !== filePath || latestCodeRef.current !== lastSavedRef.current) {
            void api.releaseLock(filePath, lock.token).catch(() => undefined);
            return;
          }
          const file = await api.readFile(filePath);
          if (pathRef.current !== filePath) {
            void api.releaseLock(filePath, lock.token).catch(() => undefined);
            return;
          }
          lockTokenRef.current = lock.token;
          setLockToken(lock.token);
          heartbeatEveryRef.current = lock.heartbeatEveryMs || heartbeatEveryRef.current;
          writeStoredLock(filePath, { token: lock.token, sessionId: lock.sessionId });
          skipNextSave.current = true;
          lastSavedRef.current = file.content;
          setSavedCode(file.content);
          latestCodeRef.current = file.content;
          baselineRef.current = { mtimeMs: file.mtimeMs, hash: file.hash };
          setCode(file.content);
          setAccess("edit");
          setLockNote(null);
          setSaveState("saved");
        } catch {
          // The other window still holds the lock.
        }
      })();
    }, heartbeatEveryRef.current);
    return () => window.clearInterval(timer);
  }, [access, filePath, loaded]);

  const runRender = useCallback(async (source: string) => {
    const generation = renderGen.current;
    try {
      const { svg } = await renderMermaid(source, FALLBACK_THEME);
      if (!mountedRef.current || generation !== renderGen.current) return;
      renderedRef.current = { source, svg };
      setSvgHtml(svg);
      setRenderError(null);
      setPreviewStale(false);
      publishThumbnail(pathRef.current, source, svg);
    } catch (err) {
      if (!mountedRef.current || generation !== renderGen.current) return;
      const message = err instanceof Error ? err.message : "Render failed";
      setRenderError(message);
      setPreviewStale(Boolean(renderedRef.current?.svg));
    }
  }, []);

  useEffect(() => {
    if (!loaded || !autoUpdate) return;
    if (renderTimer.current) window.clearTimeout(renderTimer.current);
    renderTimer.current = window.setTimeout(() => {
      void runRender(code);
    }, 280);
    return () => {
      if (renderTimer.current) window.clearTimeout(renderTimer.current);
    };
  }, [code, autoUpdate, loaded, runRender]);

  useEffect(() => {
    let cancelled = false;
    void api.tree().then(
      (result) => {
        if (!cancelled) setDiagramPaths(diagramPathsIn(result.tree));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    if (!loaded || access !== "edit" || conflict) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (code === lastSavedRef.current) return;
    const scheduledPath = filePath;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void flushSave(scheduledPath);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [code, filePath, loaded, access, conflict, flushSave]);

  const reloadFromDisk = async () => {
    const file = await api.readFile(filePath);
    skipNextSave.current = true;
    lastSavedRef.current = file.content;
    setSavedCode(file.content);
    latestCodeRef.current = file.content;
    baselineRef.current = { mtimeMs: file.mtimeMs, hash: file.hash };
    conflictRef.current = false;
    setCode(file.content);
    setConflict(null);
    setSaveState("saved");
  };

  const overwriteDisk = async () => {
    const baseline = baselineRef.current;
    try {
      const result = await api.writeFile(filePath, code, {
        force: true,
        expectedHash: baseline?.hash,
        expectedMtimeMs: baseline?.mtimeMs,
        lockToken: lockTokenRef.current,
      });
      skipNextSave.current = true;
      lastSavedRef.current = code;
      setSavedCode(code);
      baselineRef.current = { mtimeMs: result.mtimeMs, hash: result.hash };
      conflictRef.current = false;
      setConflict(null);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setLoadError(err instanceof Error ? err.message : "Could not overwrite the file");
    }
  };

  const saveCopy = async () => {
    setCopyNote(null);
    try {
      const copyPath = await writeCopy(filePath, code);
      setCopyNote(`Saved a copy to ${copyPath}`);
    } catch (err) {
      setCopyNote(err instanceof Error ? err.message : "Could not save a copy");
    }
  };

  const confirmTakeover = async () => {
    const currentPath = pathRef.current;
    setTakeoverOpen(false);
    try {
      const lock = await api.takeoverLock(currentPath, editorSessionId());
      if (pathRef.current !== currentPath) {
        releaseEditorLock(currentPath, lock.token);
        return;
      }
      const disk = await api.readFile(currentPath);
      if (pathRef.current !== currentPath) {
        releaseEditorLock(currentPath, lock.token);
        return;
      }
      lockTokenRef.current = lock.token;
      setLockToken(lock.token);
      heartbeatEveryRef.current = lock.heartbeatEveryMs || heartbeatEveryRef.current;
      writeStoredLock(currentPath, { token: lock.token, sessionId: lock.sessionId });
      const localDirty = latestCodeRef.current !== lastSavedRef.current;
      const diskChanged = baselineRef.current != null && disk.hash !== baselineRef.current.hash;
      if (diskChanged && localDirty && latestCodeRef.current !== disk.content) {
        conflictRef.current = true;
        setConflict({
          mine: latestCodeRef.current,
          disk: disk.content,
          diskMtimeMs: disk.mtimeMs,
          diskHash: disk.hash,
          open: true,
        });
        setAccess("edit");
        setLockNote(null);
        setSaveState("paused");
        return;
      }
      if (!localDirty) {
        skipNextSave.current = true;
        lastSavedRef.current = disk.content;
        setSavedCode(disk.content);
        latestCodeRef.current = disk.content;
        baselineRef.current = { mtimeMs: disk.mtimeMs, hash: disk.hash };
        setCode(disk.content);
      } else {
        baselineRef.current = { mtimeMs: disk.mtimeMs, hash: disk.hash };
      }
      setAccess("edit");
      setLockNote(null);
      setSaveState(localDirty ? "idle" : "saved");
    } catch (err) {
      if (pathRef.current !== currentPath) return;
      if (err instanceof ApiError && err.code === "locked") {
        setLockNote(STILL_HELD_NOTE);
        return;
      }
      setLockNote(err instanceof Error ? err.message : "Could not take over editing.");
    }
  };

  const handleExport = async (format: ExportFormat) => {
    setExportError(null);
    const svg = previewRef.current?.querySelector("svg");
    if (!svg) {
      setExportError("Nothing to export yet. Fix the diagram first.");
      return;
    }
    try {
      await exportDiagram(svg, diagramHeading(parseDiagram(code).title, filePath), format);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    }
  };

  useEffect(() => {
    if (!loaded || presenting || conflict?.open || historyOpen) return;
    const onKey = (event: KeyboardEvent) => {
      const action = presentationAction(keyEventFrom(event), {
        presenting: false,
        available: true,
        formField: isFormField(event.target),
        codeEditor: isCodeEditorTarget(event.target),
        atFit: true,
      });
      if (action.type !== "start") return;
      event.preventDefault();
      event.stopPropagation();
      startPresentation(() => setPresenting(true));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loaded, presenting, conflict?.open, historyOpen]);

  const readOnly = access !== "edit";
  const info = useMemo(() => parseDiagram(code), [code]);
  const heading = diagramHeading(info.title, filePath);
  const trail = useMemo(
    () => trailFromState(location.state, { path: filePath, title: heading }),
    [location.state, filePath, heading],
  );
  const linkRows = useMemo(() => {
    const known = diagramPaths ?? [filePath];
    const indexed = indexDiagramLinks([
      { path: filePath, content: code },
      ...known.filter((path) => path !== filePath).map((path) => ({ path, content: "" })),
    ]);
    return linksFor(indexed, filePath).linksTo;
  }, [code, diagramPaths, filePath]);

  useEffect(() => {
    if (!loaded) return;
    if (trail.crumbs[trail.index]?.title === heading) return;
    const next = withCrumbTitle(trail, heading);
    if (next === trail) return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: { drill: next } });
  }, [loaded, heading, trail, navigate, location.pathname, location.search]);

  useEffect(() => {
    if (!infoOpen || !filePath) return;
    let cancelled = false;
    void api.diagramLinks(filePath).then(
      (result) => {
        if (!cancelled && result.path === filePath) setLinkedFrom(result.linkedFrom);
      },
      () => {
        if (!cancelled) setLinkedFrom([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [infoOpen, filePath, savedCode]);

  const openDiagram = (path: string, title?: string) => {
    if (!path || path === filePath) return;
    const next = drillForward(trail, { path, title: title || displayName(path) });
    const params = new URLSearchParams(searchParams);
    params.delete("line");
    params.delete("find");
    const qs = params.toString();
    navigate(`/edit/${path}${qs ? `?${qs}` : ""}`, { state: { drill: next } });
  };

  const followPreviewClick = (event: { target: EventTarget | null; preventDefault: () => void }) => {
    const raw = clickTargetOnElement(code, event.target);
    if (!raw) return;
    event.preventDefault();
    const action = actionForClickTarget(raw, filePath, diagramPaths ?? null);
    if (action.type === "ignore") return;
    if (action.type === "broken") {
      setLinkMessage({ path: filePath, text: action.message });
      return;
    }
    if (action.type === "external") {
      setLinkMessage(null);
      openExternalLink(action.url);
      return;
    }
    setLinkMessage(null);
    if (access === "edit" && latestCodeRef.current !== lastSavedRef.current) {
      void flushSave(filePath).then(() => {
        if (conflictRef.current) return;
        openDiagram(action.path);
      });
      return;
    }
    openDiagram(action.path);
  };

  const linksToRows: DiagramLinkRow[] = linkRows.map((link) => ({
    path: link.path,
    label: link.path ? displayName(link.path) : link.target,
    broken: link.broken,
  }));
  const linkedFromRows: DiagramLinkRow[] = linkedFrom.map((link) => ({
    path: link.path,
    label: displayName(link.path),
  }));

  const setInfoOpen = (open: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (open) next.set("info", "1");
    else next.delete("info");
    setSearchParams(next, { replace: true });
  };

  const commitInfo = (patch: DiagramPatch) => {
    if (readOnly || info.malformed) return;
    const next = applyDiagramPatch(code, patch);
    if (next.ok) setCode(next.source);
  };

  const migrateInit = () => {
    if (readOnly) return;
    const next = migrateInitDirectives(code);
    if (next.ok && next.migrated) setCode(next.source);
  };
  useCommandHost({
    route: "editor",
    actions: {
      editDiagramInfo: () => setInfoOpen(true),
      linkNode: readOnly ? undefined : () => setLinkNodeOpen(true),
      openHistory: () => setHistoryOpen(true),
      toggleAutoUpdate: () => setAutoUpdate((current) => !current),
      setTheme: (theme) => commitInfo({ theme }),
      exportAs: (format) => {
        void handleExport(format);
      },
      present:
        loaded && !conflict?.open
          ? () => {
              startPresentation(() => setPresenting(true));
            }
          : undefined,
      find: () => {
        runFind();
      },
      replace: () => {
        runReplace();
      },
      gotoLine: () => {
        runGotoLine();
      },
    },
    items: [],
    trashItems: [],
    hasPreview: Boolean(svgHtml),
    autoUpdate,
    readOnly,
    conflictOpen: Boolean(conflict?.open),
  });

  const dirty = code !== savedCode;
  useEffect(() => {
    if (dirty) document.body.dataset.unsaved = "true";
    else delete document.body.dataset.unsaved;
    return () => {
      delete document.body.dataset.unsaved;
    };
  }, [dirty]);
  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved to disk"
        : saveState === "error"
          ? "Save failed"
          : saveState === "paused"
            ? "Autosave paused"
            : access === "readonly"
              ? "Read-only"
              : "";

  return (
    <div className="editor-layout">
      <div>
      <header className="editor-top">
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link to="/">
            <Brand compact />
          </Link>
          <div className="breadcrumb">
            Local files / <strong>{heading || "Untitled"}</strong>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <span className="status-pill" aria-live="polite">
            {saveLabel}
          </span>
          <CommandsButton />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ color: "#e8eef5" }}
            onClick={() => setInfoOpen(true)}
            disabled={!loaded}
            aria-expanded={infoOpen}
          >
            Diagram info
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ color: "#e8eef5" }}
            onClick={() => setHistoryOpen(true)}
            disabled={!loaded}
          >
            History
          </button>
          <Link className="btn btn-ghost" to="/reference" style={{ color: "#e8eef5" }}>
            Open Syntax Reference Library
          </Link>
          <label className="export-label">
            Export as
            <select
              aria-label="Export format"
              defaultValue=""
              onChange={(e) => {
                const value = e.target.value as ExportFormat | "";
                e.target.value = "";
                if (
                  value === "svg" ||
                  value === "png" ||
                  value === "jpg" ||
                  value === "pdf"
                ) {
                  void handleExport(value);
                }
              }}
            >
              <option value="" disabled>
                Choose…
              </option>
              <option value="svg">SVG</option>
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
        </div>
      </header>

      {loadError && (
        <div className="error-banner" style={{ margin: "0.75rem 1rem" }}>
          {loadError}
        </div>
      )}
      {exportError && (
        <div className="error-banner" style={{ margin: "0.75rem 1rem" }}>
          {exportError}
        </div>
      )}
      {info.malformed && (
        <div className="editor-banner" role="alert">
          The YAML header could not be parsed{info.error ? `: ${info.error}` : ""}. Autosave keeps
          the text in the code pane and will not replace the header.
        </div>
      )}
      {info.hasLegacyInit && (
        <div className="editor-banner" role="status">
          <div>
            This diagram uses a deprecated <code>%%{"{init}"}%%</code> directive. It still renders.
            Move it into front matter to keep the same theme and options in the file header.
          </div>
          <div className="editor-banner-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={migrateInit}
              disabled={readOnly || info.malformed}
            >
              Move into front matter
            </button>
          </div>
          {info.initError && <div>{info.initError}</div>}
        </div>
      )}
      {lockNote && (
        <EditorLockBanner
          note={lockNote}
          readOnly={access === "readonly"}
          dirty={dirty}
          copyNote={copyNote}
          onTakeOver={() => setTakeoverOpen(true)}
          onSaveCopy={() => void saveCopy()}
        />
      )}
      {takeoverOpen && (
        <TakeoverDialog
          onClose={() => setTakeoverOpen(false)}
          onConfirm={() => void confirmTakeover()}
        />
      )}
      {conflict && !conflict.open && (
        <div className="editor-banner" role="status">
          <div>Autosave is paused because the file on disk is different.</div>
          <div className="editor-banner-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setConflict({ ...conflict, open: true })}>
              Review both versions
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void reloadFromDisk()}>
              Reload from disk
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void overwriteDisk()}>
              Overwrite with mine
            </button>
          </div>
        </div>
      )}
      </div>

      <div className={`editor-panels${infoOpen ? " with-info" : ""}`}>
        <section className="panel code-panel">
          <div className="panel-header">
            <h2>Code</h2>
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={(e) => setAutoUpdate(e.target.checked)}
              />
              Auto-Update
            </label>
          </div>
          <div className="code-editor-wrap">
            <MermaidCodeEditor
              value={code}
              onChange={setCode}
              readOnly={readOnly}
              diagramPaths={diagramPaths}
              sourcePath={filePath}
              onDiagnostics={setDiagnostics}
              aria-label="Mermaid source editor"
            />
          </div>
          <ProblemsPanel
            diagnostics={diagnostics ?? []}
            pending={diagnostics == null}
            readOnly={readOnly}
            onSelect={(diagnostic) => {
              revealEditorRange(diagnostic.from, diagnostic.to);
            }}
            onFix={(fix) => {
              const view = getEditorView();
              if (view) applyLintFix(view, fix);
            }}
          />
          {!autoUpdate && (
            <div style={{ padding: "0.75rem 1rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void runRender(code)}
              >
                Update preview
              </button>
            </div>
          )}
        </section>

        {infoOpen && (
          <DiagramInfoPanel
            source={code}
            fileName={displayName(filePath) || "Untitled"}
            readOnly={readOnly}
            linksTo={linksToRows}
            linkedFrom={linkedFromRows}
            onOpenDiagram={(path) => openDiagram(path)}
            onChange={setCode}
            onClose={() => setInfoOpen(false)}
          />
        )}

        <section className="panel preview-panel">
          <div className="panel-header">
            <h2>Preview</h2>
            <div className="preview-toolbar">
              <AppearanceSelect
                label="Theme"
                value={info.theme ?? ""}
                emptyLabel="App default (dark)"
                options={MERMAID_THEMES.map((theme) => [theme, themeLabel(theme)])}
                disabled={readOnly || info.malformed || !loaded}
                onChange={(theme) => commitInfo({ theme })}
              />
              <AppearanceSelect
                label="Look"
                value={info.look ?? ""}
                emptyLabel="Engine default"
                options={MERMAID_LOOKS.map((look) => [
                  look,
                  look === "handDrawn" ? "Hand-drawn" : look === "neo" ? "Neo" : "Classic",
                ])}
                disabled={readOnly || info.malformed || !loaded}
                onChange={(look) => commitInfo({ look })}
              />
              <AppearanceSelect
                label="Layout"
                value={info.layout ?? ""}
                emptyLabel="Engine default"
                options={MERMAID_LAYOUTS.map((layout) => [layout, layout === "elk" ? "ELK" : "Dagre"])}
                disabled={readOnly || info.malformed || !loaded}
                onChange={(layout) => commitInfo({ layout })}
              />
              <button
                type="button"
                className="btn btn-ghost preview-present"
                onClick={() => startPresentation(() => setPresenting(true))}
                disabled={!loaded}
                aria-keyshortcuts="F5"
              >
                Present
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setInfoOpen(!infoOpen)}
              >
                {infoOpen ? "Hide info" : "Edit info"}
              </button>
            </div>
          </div>
          <DrillTrail
            trail={trail}
            onBack={() => {
              const next = drillIndex(trail, trail.index - 1);
              const crumb = next.crumbs[next.index];
              if (crumb) navigate(`/edit/${crumb.path}`, { state: { drill: next } });
            }}
            onForward={() => {
              const next = drillIndex(trail, trail.index + 1);
              const crumb = next.crumbs[next.index];
              if (crumb) navigate(`/edit/${crumb.path}`, { state: { drill: next } });
            }}
            onSelect={(index) => {
              const next = drillIndex(trail, index);
              const crumb = next.crumbs[next.index];
              if (crumb) navigate(`/edit/${crumb.path}`, { state: { drill: next } });
            }}
          />
          {linkMessage?.path === filePath ? (
            <div className="error-banner link-banner" role="alert">
              {linkMessage.text}
            </div>
          ) : null}
          <div
            className={`preview-stage${previewStale ? " is-stale" : ""}`}
            ref={previewRef}
            onClick={followPreviewClick}
          >
            {previewStale && svgHtml ? (
              <div className="preview-stale">
                <div className="preview-stale-banner" role="status">
                  <strong>Out of date.</strong> The last diagram that rendered is still shown.{" "}
                  {shortRenderError(renderError)}
                </div>
                <div className="preview-stale-frame" dangerouslySetInnerHTML={{ __html: svgHtml }} />
              </div>
            ) : renderError ? (
              <div className="preview-error" role="alert">
                {shortRenderError(renderError)}
              </div>
            ) : (
              <div dangerouslySetInnerHTML={{ __html: svgHtml }} />
            )}
          </div>
        </section>
      </div>

      {conflict?.open && (
        <ConflictDialog
          mine={conflict.mine}
          disk={conflict.disk}
          onKeep={() => setConflict({ ...conflict, open: false })}
          onReload={() => void reloadFromDisk()}
          onOverwrite={() => void overwriteDisk()}
        />
      )}
      {presenting && loaded ? (
        <PresentationView source={code} path={filePath} onExit={() => setPresenting(false)} />
      ) : null}
      {linkNodeOpen ? (
        <LinkNodeDialog
          nodeId={nodeIdAtCursor(code)}
          paths={diagramPaths ?? []}
          currentPath={filePath}
          onClose={() => setLinkNodeOpen(false)}
          onConfirm={(nodeId, diagramPath) => {
            const title = displayName(diagramPath);
            setCode(insertDiagramLink(code, nodeId, diagramPath, `Open ${title}`));
            setLinkNodeOpen(false);
          }}
        />
      ) : null}
      {historyOpen && (
        <HistoryDialog
          path={filePath}
          lockToken={lockToken}
          canRestore={access === "edit"}
          onClose={() => setHistoryOpen(false)}
          onRestored={(file) => {
            skipNextSave.current = true;
            lastSavedRef.current = file.content;
            setSavedCode(file.content);
            latestCodeRef.current = file.content;
            baselineRef.current = { mtimeMs: file.mtimeMs, hash: file.hash };
            setCode(file.content);
            setSaveState("saved");
          }}
        />
      )}
    </div>
  );
}

function nodeIdAtCursor(source: string): string {
  const view = getEditorView();
  const offset = view?.state.selection.main.head ?? source.length;
  const start = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const endBreak = source.indexOf("\n", offset);
  const line = source.slice(start, endBreak < 0 ? source.length : endBreak);
  return extractNodeIds(line)[0] ?? extractNodeIds(source)[0] ?? "";
}

function diagramPathsIn(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type === "file") paths.push(node.path);
      else if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return paths;
}

function revealEditorRange(from: number, to: number): void {
  const view = getEditorView();
  if (!view) return;
  view.focus();
  view.dispatch({
    selection: { anchor: from, head: Math.max(to, from) },
    scrollIntoView: true,
  });
}

function shortRenderError(message: string | null): string {
  if (!message) return "The diagram could not be updated.";
  const line =
    message
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item && !/^[-^]+$/.test(item)) ?? message;
  if (/^Parse error on line/i.test(line)) {
    return "Mermaid could not read the diagram. The problems list marks the line.";
  }
  return line.length > 180 ? `${line.slice(0, 177)}…` : line;
}

function AppearanceSelect({
  label,
  value,
  emptyLabel,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  options: [string, string][];
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const known = new Set(options.map(([option]) => option));
  return (
    <label>
      {label}{" "}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{emptyLabel}</option>
        {value && !known.has(value) ? <option value={value}>{value}</option> : null}
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
