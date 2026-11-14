import { useEffect, useState } from "react";
import type { LinkRepairPlan, LinkRepairSuggestion } from "../../../server/src/diagramLinks.ts";
import { api } from "../api";

type RepairLinksDialogProps = {
  lockToken?: string | null;
  onClose: () => void;
  onApplied: (saved: string[]) => void;
};

function confirmedChoices(plan: LinkRepairPlan): { from: string; to: string }[] {
  return plan.suggestions.flatMap((item) =>
    item.to && item.match !== "ambiguous" ? [{ from: item.from, to: item.to }] : [],
  );
}

function reasonFor(match: LinkRepairSuggestion["match"]): string {
  if (match === "content") return "same content";
  if (match === "basename") return "same file name";
  return "more than one match";
}

/**
 * Preview of click rewrites after a diagram was renamed outside the app.
 * Opening this dialog only reads. Files change when Repair links is confirmed.
 */
export function RepairLinksDialog({ lockToken = null, onClose, onApplied }: RepairLinksDialogProps) {
  const [plan, setPlan] = useState<LinkRepairPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.previewLinkRepairs().then(
      (next) => {
        if (!cancelled) setPlan(next);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not preview link repairs");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const choices = plan ? confirmedChoices(plan) : [];
  const ambiguous = plan?.suggestions.filter((item) => item.to == null || item.match === "ambiguous") ?? [];
  const dataFiles = plan?.dataFiles ?? [];
  const canApply = choices.length > 0 && !busy;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repair-links-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canApply || !plan) return;
          setBusy(true);
          setError(null);
          void api
            .applyLinkRepairs({ lockToken, choices })
            .then((result) => onApplied(result.saved))
            .catch((err: unknown) => {
              setBusy(false);
              setError(err instanceof Error ? err.message : "Could not repair links");
            });
        }}
      >
        <h3 id="repair-links-title">Repair links</h3>
        <p>
          These look like diagrams renamed or moved outside NerdGram. Nothing is written until you confirm.
        </p>
        {plan == null && !error ? <p>Looking for renamed diagrams…</p> : null}
        {error ? <p className="error-banner">{error}</p> : null}
        {plan && choices.length === 0 && ambiguous.length === 0 ? (
          <p>No renamed diagram matches a broken link.</p>
        ) : null}
        {choices.length > 0 ? (
          <ul className="affected-links">
            {choices.map((item) => {
              const suggestion = plan?.suggestions.find((entry) => entry.from === item.from);
              return (
                <li key={item.from}>
                  <code>{item.from}</code> → <code>{item.to}</code>
                  {suggestion ? ` (${reasonFor(suggestion.match)})` : ""}
                </li>
              );
            })}
          </ul>
        ) : null}
        {plan && plan.changes.length > 0 ? (
          <ul className="affected-links">
            {plan.changes.map((change) => (
              <li key={change.path}>
                <strong>{change.path}</strong>
                <ul>
                  {change.links.map((link) => (
                    <li key={`${change.path}-${link.line}-${link.target}`}>
                      Line {link.line}: <code>{link.target}</code> → <code>{link.next}</code>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
        {dataFiles.length > 0 ? (
          <>
            <p>The data file moved with the diagram. Repair updates the source path in the front matter.</p>
            <ul className="affected-links">
              {dataFiles.map((item) => (
                <li key={`${item.diagram}:${item.from}`}>
                  <strong>{item.diagram}</strong>: <code>{item.from}</code> → <code>{item.to}</code>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {ambiguous.length > 0 ? (
          <>
            <p>These matches are ambiguous, so they are not changed.</p>
            <ul className="affected-links">
              {ambiguous.map((item) => (
                <li key={item.from}>
                  <code>{item.from}</code> matches {item.candidates.join(", ")}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canApply}>
            Repair links
          </button>
        </div>
      </form>
    </div>
  );
}
