import type { Dispatch, ReactNode } from "react";
import type { FlowDirection } from "../../../server/src/diagramData.ts";
import {
  canCreate,
  canInspect,
  edgeFields,
  fieldsFor,
  showEdgeFields,
  type WizardAction,
  type WizardState,
} from "../lib/generateWizard";

const DIRECTIONS: { value: FlowDirection; label: string }[] = [
  { value: "LR", label: "Left to right" },
  { value: "TD", label: "Top to bottom" },
  { value: "TB", label: "Top to bottom (TB)" },
  { value: "RL", label: "Right to left" },
  { value: "BT", label: "Bottom to top" },
];

type GenerateWizardProps = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  busy: boolean;
  folderControl?: ReactNode;
  onInspect: (step: "map" | "preview") => void;
  onCreate: () => void;
};

export function GenerateWizard({ state, dispatch, busy, folderControl, onInspect, onCreate }: GenerateWizardProps) {
  const fields = fieldsFor(state);
  return (
    <div className="generate-wizard">
      <ol className="generate-steps" aria-label="Steps">
        <li className={state.step === "input" ? "active" : ""}>Data</li>
        <li className={state.step === "map" ? "active" : ""}>Columns</li>
        <li className={state.step === "preview" ? "active" : ""}>Preview</li>
      </ol>

      {state.fatal ? <div className="error-banner">{state.fatal}</div> : null}
      <IssueList title="Rows to fix" issues={state.errors} />
      {state.step !== "input" ? <IssueList title="Warnings" issues={state.warnings} /> : null}

      {state.step === "input" ? (
        <div className="generate-panel">
          <label htmlFor="generate-data">CSV or JSON</label>
          <textarea
            id="generate-data"
            value={state.text}
            onChange={(event) => dispatch({ type: "text", text: event.target.value })}
            spellCheck={false}
            rows={12}
            placeholder={"Local Device,Local Port,Remote Device,Remote Port\nCore,Gi0/0,Atlanta,Gi0/1"}
          />
          <label className="generate-file">
            Upload a file
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              aria-label="Upload CSV or JSON"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void file.text().then((text) => dispatch({ type: "text", text, fileName: file.name }));
              }}
            />
          </label>
          <label htmlFor="generate-edges">Edges file, if the first file is only nodes</label>
          <textarea
            id="generate-edges"
            value={state.edgesText}
            onChange={(event) => dispatch({ type: "edges", text: event.target.value })}
            spellCheck={false}
            rows={5}
            placeholder="source,target,label"
          />
          <div className="generate-actions">
            <button type="button" className="btn btn-primary" disabled={!canInspect(state) || busy} onClick={() => onInspect("map")}>
              {busy ? "Reading…" : "Continue"}
            </button>
          </div>
        </div>
      ) : null}

      {state.step === "map" ? (
        <div className="generate-panel">
          <label htmlFor="generate-shape">Data shape</label>
          <select
            id="generate-shape"
            value={state.shape}
            onChange={(event) => dispatch({ type: "shape", shape: event.target.value as WizardState["shape"] })}
          >
            <option value="auto">Detected ({state.detectedShape || "unknown"})</option>
            <option value="links">Links table</option>
            <option value="nodes">Nodes</option>
            <option value="graph">Nodes and edges</option>
            <option value="edges">Edges</option>
          </select>
          <div className="generate-map">
            {fields.map((field) => (
              <label key={field.field} htmlFor={`map-${field.field}`}>
                {field.label}
                {field.required ? " (required)" : ""}
                <select
                  id={`map-${field.field}`}
                  value={state.mapping[field.field] ?? ""}
                  onChange={(event) => dispatch({ type: "mapping", field: field.field, column: event.target.value })}
                >
                  <option value="">Ignore</option>
                  {state.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {showEdgeFields(state) ? (
            <div className="generate-map">
              {edgeFields().map((field) => (
                <label key={field.field} htmlFor={`edge-${field.field}`}>
                  Edge {field.label.toLowerCase()}
                  {field.required ? " (required)" : ""}
                  <select
                    id={`edge-${field.field}`}
                    value={state.edgesMapping[field.field] ?? ""}
                    onChange={(event) =>
                      dispatch({ type: "edgesMapping", field: field.field, column: event.target.value })
                    }
                  >
                    <option value="">Ignore</option>
                    {state.edgesHeaders.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          <label htmlFor="generate-direction">Direction</label>
          <select
            id="generate-direction"
            value={state.direction}
            onChange={(event) => dispatch({ type: "direction", direction: event.target.value as FlowDirection })}
          >
            {DIRECTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <label className="generate-check" htmlFor="generate-grouping">
            <input
              id="generate-grouping"
              type="checkbox"
              checked={state.grouping}
              onChange={(event) => dispatch({ type: "grouping", grouping: event.target.checked })}
            />
            Groups become subgraphs
          </label>
          <div className="generate-actions">
            <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: "back" })}>
              Back
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onInspect("preview")}>
              {busy ? "Building…" : "Preview"}
            </button>
          </div>
        </div>
      ) : null}

      {state.step === "preview" ? (
        <div className="generate-panel">
          <div className="paste-fields">
            <div>
              <label htmlFor="generate-name">Diagram name</label>
              <input
                id="generate-name"
                value={state.diagramName}
                onChange={(event) => dispatch({ type: "meta", diagramName: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="generate-title">Title</label>
              <input
                id="generate-title"
                value={state.title}
                onChange={(event) => dispatch({ type: "meta", title: event.target.value })}
              />
            </div>
            <div>
              <span className="paste-label" id="generate-folder-label">
                Folder
              </span>
              {folderControl ?? (
                <input
                  aria-labelledby="generate-folder-label"
                  value={state.folder}
                  onChange={(event) => dispatch({ type: "meta", folder: event.target.value })}
                />
              )}
            </div>
          </div>
          <p className="generate-counts">
            {state.counts.nodes} nodes, {state.counts.edges} edges
            {state.counts.groups > 0 ? `, ${state.counts.groups} groups` : ""}
          </p>
          <label htmlFor="generate-preview">Mermaid preview</label>
          <textarea id="generate-preview" readOnly value={state.mermaid} spellCheck={false} rows={16} />
          <div className="generate-actions">
            <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: "back" })}>
              Back
            </button>
            <button type="button" className="btn btn-primary" disabled={!canCreate(state) || busy} onClick={onCreate}>
              {busy ? "Creating…" : "Create diagram"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IssueList({ title, issues }: { title: string; issues: { row: number; message: string }[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="error-banner" role="alert">
      <strong>{title}</strong>
      <ul>
        {issues.map((issue) => (
          <li key={`${issue.row}-${issue.message}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}
