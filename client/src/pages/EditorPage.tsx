import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Brand } from "../components/Brand";
import { MermaidCodeEditor } from "../components/MermaidCodeEditor";
import { exportDiagram, type ExportFormat } from "../lib/exportDiagram";
import {
  initMermaid,
  renderMermaid,
  type MermaidTheme,
} from "../lib/mermaidRender";
import { displayName } from "../lib/paths";

export function EditorPage() {
  const params = useParams();
  const filePath = params["*"] || "";

  const [code, setCode] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [theme, setTheme] = useState<MermaidTheme>("dark");
  const [svgHtml, setSvgHtml] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [exportError, setExportError] = useState<string | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const renderTimer = useRef<number | null>(null);
  const skipNextSave = useRef(true);

  useEffect(() => {
    initMermaid(theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    skipNextSave.current = true;
    (async () => {
      if (!filePath) {
        setLoadError("Missing diagram path");
        return;
      }
      try {
        const file = await api.readFile(filePath);
        if (!cancelled) {
          setCode(file.content);
          setLoadError(null);
          setLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load");
          setLoaded(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

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
    if (!loaded || !filePath) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await api.writeFile(filePath, code);
          setSaveState("saved");
        } catch {
          setSaveState("error");
        }
      })();
    }, 500);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [code, filePath, loaded]);

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

  return (
    <div className="editor-layout">
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
          <span className="status-pill">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved to disk"
                : saveState === "error"
                  ? "Save failed"
                  : ""}
          </span>
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
    </div>
  );
}
