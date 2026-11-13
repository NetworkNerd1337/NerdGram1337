type ItemActionsProps = {
  label: string;
  favorited?: boolean;
  onFavorite?: () => void;
  onPresent?: () => void;
  onRename: () => void;
  onMove: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export function ItemActions({
  label,
  favorited = false,
  onFavorite,
  onPresent,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
}: ItemActionsProps) {
  return (
    <div className="card-actions">
      {onFavorite ? (
        <button type="button" className="btn btn-ghost" onClick={onFavorite}>
          {favorited ? "Unfavorite" : "Favorite"}
        </button>
      ) : null}
      {onPresent ? (
        <button type="button" className="btn btn-ghost" onClick={onPresent} aria-label={`Present ${label}`}>
          Present
        </button>
      ) : null}
      <button type="button" className="btn btn-ghost" onClick={onRename}>
        Rename
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onMove}
        aria-label={`Move ${label} to another folder`}
      >
        Move to…
      </button>
      <button type="button" className="btn btn-ghost" onClick={onDuplicate} aria-label={`Duplicate ${label}`}>
        Duplicate
      </button>
      <button type="button" className="btn btn-danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
