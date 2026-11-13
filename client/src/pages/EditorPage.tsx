import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { Brand } from "../components/Brand";
import { ConflictDialog } from "../components/ConflictDialog";
import { HistoryDialog } from "../components/HistoryDialog";
import { MermaidCodeEditor } from "../components/MermaidCodeEditor";
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
  initMermaid,
  renderMermaid,
  type MermaidTheme,
} from "../lib/mermaidRender";
import { displayName, joinPath, parentPath } from "../lib/paths";

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

  const [code, setCode] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [access, setAccess] = useState<Access>("loading");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [theme, setTheme] = useState<MermaidTheme>("dark");
  const [svgHtml, setSvgHtml] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error" | "paused"
  >("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [lockNote, setLockNote] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedCode, setSavedCode] = useState("");
  const [lockToken, setLockToken] = useState<string | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    initMermaid(theme);
  }, [theme]);

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
    setCopyNote(null);
    setHistoryOpen(false);
    setLoadError(null);
    setSaveState("idle");
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
          setLockNote(
            "This diagram is open in another window. You can view it, but changes are not saved.",
          );
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
        void api.releaseLock(filePath, token).catch(() => undefined);
      });
    };
  }, [filePath]);

  useEffect(() => {
    if (access !== "edit") return;
    const onHide = () => {
      const token = lockTokenRef.current;
      if (!token) return;
      clearStoredLock(filePath);
      void api.releaseLock(filePath, token, { keepalive: true }).catch(() => undefined);
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

  const runRender = useCallback(async (source: string, nextTheme: MermaidTheme) => {
    try {
      const { svg } = await renderMermaid(source, nextTheme);
      setSvgHtml(svg);
      setRenderError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Render failed";
      setRenderError(message);
      setSvgHtml("");
    }
  }, []);

  useEffect(() => {
    if (!loaded || !autoUpdate) return;
    if (renderTimer.current) window.clearTimeout(renderTimer.current);
    renderTimer.current = window.setTimeout(() => {
      void runRender(code, theme);
    }, 280);
    return () => {
      if (renderTimer.current) window.clearTimeout(renderTimer.current);
    };
  }, [code, theme, autoUpdate, loaded, runRender]);

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

  const handleExport = async (format: ExportFormat) => {
    setExportError(null);
    const svg = previewRef.current?.querySelector("svg");
    if (!svg) {
      setExportError("Nothing to export yet. Fix the diagram first.");
      return;
    }
    try {
      await exportDiagram(svg, displayName(filePath), format);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    }
  };

  const readOnly = access !== "edit";
  const dirty = code !== savedCode;
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
            Local files / <strong>{displayName(filePath) || "Untitled"}</strong>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <span className="status-pill" aria-live="polite">
            {saveLabel}
          </span>
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
      {lockNote && (
        <div className="editor-banner" role="status">
          <div>{lockNote}</div>
          {access === "readonly" && dirty && (
            <div className="editor-banner-actions">
              <button type="button" className="btn btn-primary" onClick={() => void saveCopy()}>
                Save a copy
              </button>
            </div>
          )}
          {copyNote && <div>{copyNote}</div>}
        </div>
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

      <div className="editor-panels">
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
              aria-label="Mermaid source editor"
            />
          </div>
          {!autoUpdate && (
            <div style={{ padding: "0.75rem 1rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void runRender(code, theme)}
              >
                Update preview
              </button>
            </div>
          )}
        </section>

        <section className="panel preview-panel">
          <div className="panel-header">
            <h2>Preview</h2>
            <div className="preview-toolbar">
              <label>
                Theme{" "}
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as MermaidTheme)}
                >
                  <option value="dark">Dark</option>
                  <option value="default">Default</option>
                  <option value="neutral">Neutral</option>
                  <option value="forest">Forest</option>
                  <option value="base">Base</option>
                </select>
              </label>
            </div>
          </div>
          <div className="preview-stage" ref={previewRef}>
            {renderError ? (
              <div className="preview-error">{renderError}</div>
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
