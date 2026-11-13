import { Link } from "react-router-dom";
import type { DragPayload } from "../lib/drag";
import type { TreeNode } from "../types";
import { Brand } from "./Brand";
import { CommandsButton } from "./CommandPalette";
import { FolderTree } from "./FolderTree";
import { displayName } from "../lib/paths";

type SidebarProps = {
  tree: TreeNode[];
  favorites: string[];
  currentFolder: string;
  search: string;
  onSearch: (value: string) => void;
  namesOnly?: boolean;
  onNamesOnly?: (value: boolean) => void;
  onSelectFolder: (path: string) => void;
  trashCount?: number;
  trashActive?: boolean;
  onOpenTrash?: () => void;
  dropHighlight?: { path: string; valid: boolean } | null;
  onFolderDragOver?: (path: string, event: DragPayload) => void;
  onFolderDrop?: (path: string, event: DragPayload) => void;
  onTrashDragOver?: (event: DragPayload) => void;
  onTrashDrop?: (event: DragPayload) => void;
};

export function Sidebar({
  tree,
  favorites,
  currentFolder,
  search,
  onSearch,
  namesOnly = false,
  onNamesOnly,
  onSelectFolder,
  trashCount = 0,
  trashActive = false,
  onOpenTrash,
  dropHighlight = null,
  onFolderDragOver,
  onFolderDrop,
  onTrashDragOver,
  onTrashDrop,
}: SidebarProps) {
  const rootDrop =
    dropHighlight?.path === ""
      ? dropHighlight.valid
        ? " drop-valid"
        : " drop-invalid"
      : "";
  return (
    <aside className="sidebar">
      <Link to="/" onClick={() => onSelectFolder("")}>
        <Brand />
      </Link>

      <div className="search-box">
        <span aria-hidden="true">⌕</span>
        <input
          id="diagram-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search diagrams"
          aria-label="Search diagrams"
        />
      </div>
      <label className="search-option">
        <input
          type="checkbox"
          checked={namesOnly}
          onChange={(event) => onNamesOnly?.(event.target.checked)}
        />
        Names only
      </label>
      <CommandsButton />

      <div className="nav-section">
        <div className="nav-label">Your space</div>
        <button
          type="button"
          className={`nav-link${currentFolder === "" && !trashActive ? " active" : ""}${rootDrop}`}
          onClick={() => onSelectFolder("")}
          onDragOver={onFolderDragOver ? (event) => onFolderDragOver("", event) : undefined}
          onDrop={onFolderDrop ? (event) => onFolderDrop("", event) : undefined}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={`nav-link${trashActive ? " active" : ""}`}
          onClick={() => onOpenTrash?.()}
          onDragOver={onTrashDragOver}
          onDrop={onTrashDrop}
        >
          Trash{trashCount > 0 ? ` (${trashCount})` : ""}
        </button>
        <FolderTree
          nodes={tree}
          currentPath={currentFolder}
          onSelectFolder={onSelectFolder}
          dropHighlight={dropHighlight}
          onFolderDragOver={onFolderDragOver}
          onFolderDrop={onFolderDrop}
        />
      </div>

      <div className="nav-section">
        <div className="nav-label">Reference</div>
        <Link className="nav-link" to="/reference">
          Open Syntax Reference Library
        </Link>
      </div>

      <div className="favorites-box">
        <strong>Favorites</strong>
        {favorites.length === 0 ? (
          <p>Favorited diagrams appear here for quick access.</p>
        ) : (
          <ul>
            {favorites.map((path) => (
              <li key={path}>
                <Link to={`/edit/${path}`}>
                  {displayName(path)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
