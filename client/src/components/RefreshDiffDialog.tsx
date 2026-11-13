type DiffNode = { id: string; label: string };
type DiffChange = { id: string; label: string; before: string; after: string; fields: string[] };
type DiffEdge = { source: string; target: string; label: string };
type DiffEdgeChange = { source: string; target: string; before: string; after: string };

export type RefreshDiff = {
  nodes: { added: DiffNode[]; removed: DiffNode[]; changed: DiffChange[] };
  edges: { added: DiffEdge[]; removed: DiffEdge[]; changed: DiffEdgeChange[] };
};

type RefreshDiffDialogProps = {
  dataPath: string;
  diff: RefreshDiff;
  warnings: { row: number; message: string }[];
  error: string | null;
  rowErrors: { row: number; message: string }[];
  onApply: () => void;
  onClose: () => void;
};

export function RefreshDiffDialog({
  dataPath,
  diff,
  warnings,
  error,
  rowErrors,
  onApply,
  onClose,
}: RefreshDiffDialogProps) {
  const empty =
    diff.nodes.added.length +
      diff.nodes.removed.length +
      diff.nodes.changed.length +
      diff.edges.added.length +
      diff.edges.removed.length +
      diff.edges.changed.length ===
    0;
  const blocked = Boolean(error) || rowErrors.length > 0;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="modal refresh-diff"
        role="dialog"
        aria-labelledby="refresh-diff-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked) onApply();
        }}
      >
        <h3 id="refresh-diff-title">Refresh from data</h3>
        <p>
          Data file <code>{dataPath}</code>. Lines outside <code>%% nerdgram:generated</code> stay as they are.
        </p>
        {error ? <div className="error-banner">{error}</div> : null}
        {rowErrors.length > 0 ? (
          <div className="error-banner" role="alert">
            <ul>
              {rowErrors.map((issue) => (
                <li key={`${issue.row}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {empty && !blocked ? <p>No nodes or edges changed. Applying still rewrites the generated block.</p> : null}
        <DiffList title="Nodes added" items={diff.nodes.added.map((node) => `${node.id}: ${node.label}`)} />
        <DiffList title="Nodes removed" items={diff.nodes.removed.map((node) => `${node.id}: ${node.label}`)} />
        <DiffList
          title="Nodes changed"
          items={diff.nodes.changed.map((node) => `${node.id} (${node.fields.join(", ")}): ${node.before} → ${node.after}`)}
        />
        <DiffList title="Edges added" items={diff.edges.added.map(edgeText)} />
        <DiffList title="Edges removed" items={diff.edges.removed.map(edgeText)} />
        <DiffList
          title="Edges changed"
          items={diff.edges.changed.map((edge) => `${edge.source} → ${edge.target}: ${edge.before || "(none)"} → ${edge.after || "(none)"}`)}
        />
        {warnings.length > 0 ? (
          <div className="status-banner">
            <ul>
              {warnings.map((issue) => (
                <li key={`${issue.row}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={blocked}>
            Apply refresh
          </button>
        </div>
      </form>
    </div>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function edgeText(edge: DiffEdge): string {
  return edge.label ? `${edge.source} → ${edge.target} (${edge.label})` : `${edge.source} → ${edge.target}`;
}
