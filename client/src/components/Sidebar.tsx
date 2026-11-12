import { Link } from "react-router-dom";
import type { TreeNode } from "../types";
import { Brand } from "./Brand";
import { FolderTree } from "./FolderTree";
import { displayName } from "../lib/paths";

type SidebarProps = {
  tree: TreeNode[];
  favorites: string[];
  currentFolder: string;
  search: string;
  onSearch: (value: string) => void;
  onSelectFolder: (path: string) => void;
};

export function Sidebar({
  tree,
  favorites,
  currentFolder,
  search,
  onSearch,
  onSelectFolder,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <Link to="/" onClick={() => onSelectFolder("")}>
        <Brand />
      </Link>

      <div className="search-box">
        <span aria-hidden="true">⌕</span>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search diagrams"
          aria-label="Search diagrams"
        />
      </div>

      <div className="nav-section">
        <div className="nav-label">Your space</div>
        <button
          type="button"
          className={`nav-link${currentFolder === "" ? " active" : ""}`}
          onClick={() => onSelectFolder("")}
        >
          Dashboard
        </button>
        <FolderTree
          nodes={tree}
          currentPath={currentFolder}
          onSelectFolder={onSelectFolder}
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
