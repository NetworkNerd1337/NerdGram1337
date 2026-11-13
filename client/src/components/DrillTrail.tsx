import type { DrillTrail as DrillTrailModel } from "../lib/drillTrail";

type DrillTrailProps = {
  trail: DrillTrailModel;
  onBack: () => void;
  onForward: () => void;
  onSelect: (index: number) => void;
  className?: string;
};

/** Path taken through linked diagrams, with back and forward. */
export function DrillTrail({ trail, onBack, onForward, onSelect, className }: DrillTrailProps) {
  const shown = trail.crumbs;
  if (shown.length <= 1) return null;
  const classNames = ["drill-trail", className].filter(Boolean).join(" ");
  return (
    <nav className={classNames} aria-label="Diagram trail">
      <button type="button" onClick={onBack} disabled={trail.index <= 0} aria-label="Back">
        Back
      </button>
      <ol>
        {shown.map((crumb, index) => {
          const current = index === trail.index;
          return (
            <li key={`${crumb.path}:${index}`}>
              {current ? (
                <span aria-current="page">{crumb.title}</span>
              ) : (
                <button type="button" onClick={() => onSelect(index)}>
                  {crumb.title}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={onForward}
        disabled={trail.index >= trail.crumbs.length - 1}
        aria-label="Forward"
      >
        Forward
      </button>
    </nav>
  );
}
