import { useMemo, useState } from "react";
import { displayName } from "../lib/paths";

type LinkNodeDialogProps = {
  nodeId: string;
  paths: readonly string[];
  currentPath: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (nodeId: string, diagramPath: string) => void;
};

/** Inserts a Mermaid `click` line that points at another diagram. */
export function LinkNodeDialog({
  nodeId: initialNodeId,
  paths,
  currentPath,
  busy = false,
  onClose,
  onConfirm,
}: LinkNodeDialogProps) {
  const [nodeId, setNodeId] = useState(initialNodeId);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const choices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return paths
      .filter((path) => path !== currentPath)
      .filter((path) => !needle || path.toLowerCase().includes(needle) || displayName(path).toLowerCase().includes(needle))
      .slice(0, 80);
  }, [paths, currentPath, query]);
  const nodeOk = /^[A-Za-z_][\w-]*$/.test(nodeId.trim());

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-node-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && nodeOk && chosen) onConfirm(nodeId.trim(), chosen);
        }}
      >
        <h3 id="link-node-title">Link node to diagram</h3>
        <p>Inserts a Mermaid <code>click</code> line. The node opens that diagram in NerdGram.</p>
        <label>
          Node id
          <input
            value={nodeId}
            aria-label="Node id"
            autoFocus
            onChange={(event) => setNodeId(event.target.value)}
          />
        </label>
        {!nodeOk ? <p className="dialog-note">Use the id from the diagram, such as Atlanta.</p> : null}
        <label>
          Find a diagram
          <input
            value={query}
            aria-label="Find a diagram"
            placeholder="Name or path"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <ul className="link-node-list" aria-label="Diagrams">
          {choices.length === 0 ? <li className="dialog-note">No other diagrams match.</li> : null}
          {choices.map((path) => (
            <li key={path}>
              <label>
                <input
                  type="radio"
                  name="link-target"
                  value={path}
                  checked={chosen === path}
                  onChange={() => setChosen(path)}
                />
                <span>
                  {displayName(path)} <code>{path}</code>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !nodeOk || !chosen}>
            Insert link
          </button>
        </div>
      </form>
    </div>
  );
}
