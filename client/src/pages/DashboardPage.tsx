import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { MermaidThumbnail } from "../components/MermaidThumbnail";
import { Modal } from "../components/Modal";
import { Sidebar } from "../components/Sidebar";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  displayName,
  ensureMmd,
  flattenFiles,
  formatRelativeTime,
  joinPath,
} from "../lib/paths";
import type { TreeNode } from "../types";

function findFolder(nodes: TreeNode[], path: string): TreeNode[] {
  if (!path) return nodes;
  const parts = path.split("/").filter(Boolean);
  let current = nodes;
  for (const part of parts) {
    const next = current.find((n) => n.type === "folder" && n.name === part);
    if (!next?.children) return [];
    current = next.children;
  }
  return current;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { tree, favorites, loading, error, refresh, toggleFavorite } =
    useWorkspace();
  const [folder, setFolder] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [modal, setModal] = useState<
    | null
    | { type: "folder" }
    | { type: "diagram" }
    | { type: "rename"; path: string; isFolder: boolean }
  >(null);
  const [nameValue, setNameValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const folderNodes = useMemo(() => findFolder(tree, folder), [tree, folder]);
  const folders = folderNodes.filter((n) => n.type === "folder");
  const files = folderNodes.filter((n) => n.type === "file");

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    return flattenFiles(tree).filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q),
    );
  }, [search, tree]);

  const openCreateFolder = () => {
    setNameValue("");
    setModal({ type: "folder" });
  };

  const openCreateDiagram = () => {
    setNameValue("Untitled");
    setModal({ type: "diagram" });
  };

  const openRename = (path: string, isFolder: boolean) => {
    setNameValue(displayName(path));
    setModal({ type: "rename", path, isFolder });
  };

  const handleConfirm = async () => {
    if (!modal) return;
    setActionError(null);
    try {
      if (modal.type === "folder") {
        const name = nameValue.trim();
        if (!name) throw new Error("Folder name is required");
        const path = joinPath(folder, name);
        await api.createFolder(path);
        await refresh();
        setFolder(path);
      } else if (modal.type === "diagram") {
        const filename = ensureMmd(nameValue || "Untitled");
        const path = joinPath(folder, filename);
        await api.writeFile(
          path,
          "flowchart TD\n  A[Start] --> B[Edit me]\n",
        );
        await refresh();
        navigate(`/edit/${path}`);
        return;
      } else if (modal.type === "rename") {
        const nextName = modal.isFolder
          ? nameValue.trim()
          : ensureMmd(nameValue);
        if (!nextName) throw new Error("Name is required");
        const parent = modal.path.includes("/")
          ? modal.path.slice(0, modal.path.lastIndexOf("/"))
          : "";
        const to = joinPath(parent, nextName);
        await api.rename(modal.path, to);
        await refresh();
      }
      setModal(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  };

  const handleDelete = async (path: string) => {
    if (!window.confirm(`Delete "${displayName(path)}"?`)) return;
    setActionError(null);
    try {
      await api.delete(path);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const title = folder ? displayName(folder) : "Dashboard";

  return (
    <div className="app-shell">
      <Sidebar
        tree={tree}
        favorites={favorites}
        currentFolder={folder}
        search={search}
        onSearch={setSearch}
        onSelectFolder={setFolder}
      />
      <main className="main">
        <div className="page-header">
          <h1>{search.trim() ? "Search" : title}</h1>
          <Link className="btn btn-ghost" to="/new">
            Paste Mermaid
          </Link>
        </div>

        {(error || actionError) && (
          <div className="error-banner">{actionError || error}</div>
        )}

        <div className="toolbar">
          <button type="button" className="btn btn-primary" onClick={openCreateDiagram}>
            New diagram
          </button>
          <button type="button" className="btn btn-ghost" onClick={openCreateFolder}>
            New folder
          </button>
          <div className="view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={view === "grid" ? "active" : ""}
              onClick={() => setView("grid")}
            >
              Grid
            </button>
            <button
              type="button"
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              List
            </button>
          </div>
        </div>

        {loading ? <p>Loading workspace…</p> : null}

        {searchResults ? (
          <>
            <div className="section-title">
              {searchResults.length} match{searchResults.length === 1 ? "" : "es"}
            </div>
            {searchResults.length === 0 ? (
              <div className="empty-state">No diagrams match that search.</div>
            ) : view === "grid" ? (
              <div className="card-grid">
                {searchResults.map((file) => (
                  <DiagramCard
                    key={file.path}
                    path={file.path}
                    mtimeMs={file.mtimeMs}
                    favorited={favorites.includes(file.path)}
                    onFavorite={() => void toggleFavorite(file.path)}
                    onRename={() => openRename(file.path, false)}
                    onDelete={() => void handleDelete(file.path)}
                  />
                ))}
              </div>
            ) : (
              <div className="list-view">
                {searchResults.map((file) => (
                  <ListRow
                    key={file.path}
                    path={file.path}
                    mtimeMs={file.mtimeMs}
                    favorited={favorites.includes(file.path)}
                    onFavorite={() => void toggleFavorite(file.path)}
                    onRename={() => openRename(file.path, false)}
                    onDelete={() => void handleDelete(file.path)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {folders.length > 0 && (
              <>
                <div className="section-title">Folders</div>
                <div className="card-grid">
                  {folders.map((f) => (
                    <article key={f.path} className="card folder-card">
                      <button
                        type="button"
                        className="folder-open"
                        onClick={() => setFolder(f.path)}
                      >
                        <h3>
                          <span className="folder-glyph" aria-hidden="true" />
                          {f.name}
                        </h3>
                        <p>
                          {(f.children || []).filter((c) => c.type === "file").length}{" "}
                          diagram
                          {(f.children || []).filter((c) => c.type === "file")
                            .length === 1
                            ? ""
                            : "s"}
                        </p>
                      </button>
                      <div className="card-body">
                        <div className="card-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => openRename(f.path, true)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => void handleDelete(f.path)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}

            <div className="section-title">Diagrams</div>
            {files.length === 0 ? (
              <div className="empty-state">
                No diagrams here yet. Create one or paste Mermaid markdown.
              </div>
            ) : view === "grid" ? (
              <div className="card-grid">
                {files.map((file) => (
                  <DiagramCard
                    key={file.path}
                    path={file.path}
                    mtimeMs={file.mtimeMs}
                    favorited={favorites.includes(file.path)}
                    onFavorite={() => void toggleFavorite(file.path)}
                    onRename={() => openRename(file.path, false)}
                    onDelete={() => void handleDelete(file.path)}
                  />
                ))}
              </div>
            ) : (
              <div className="list-view">
                {files.map((file) => (
                  <ListRow
                    key={file.path}
                    path={file.path}
                    mtimeMs={file.mtimeMs}
                    favorited={favorites.includes(file.path)}
                    onFavorite={() => void toggleFavorite(file.path)}
                    onRename={() => openRename(file.path, false)}
                    onDelete={() => void handleDelete(file.path)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {modal && (
        <Modal
          title={
            modal.type === "folder"
              ? "New folder"
              : modal.type === "diagram"
                ? "New diagram"
                : "Rename"
          }
          confirmLabel={modal.type === "rename" ? "Rename" : "Create"}
          onClose={() => setModal(null)}
          onConfirm={() => void handleConfirm()}
        >
          <label htmlFor="name-input">
            {modal.type === "folder" ? "Folder name" : "Diagram name"}
          </label>
          <input
            id="name-input"
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            placeholder={modal.type === "folder" ? "Projects" : "Untitled"}
          />
        </Modal>
      )}
    </div>
  );
}

function DiagramCard({
  path,
  mtimeMs,
  favorited,
  onFavorite,
  onRename,
  onDelete,
}: {
  path: string;
  mtimeMs: number;
  favorited: boolean;
  onFavorite: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="card">
      <Link to={`/edit/${path}`}>
        <MermaidThumbnail path={path} />
      </Link>
      <div className="card-body">
        <h3>
          <Link to={`/edit/${path}`}>{displayName(path)}</Link>
        </h3>
        <p>Updated {formatRelativeTime(mtimeMs)}</p>
        <div className="card-actions">
          <button type="button" className="btn btn-ghost" onClick={onFavorite}>
            {favorited ? "Unfavorite" : "Favorite"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onRename}>
            Rename
          </button>
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function ListRow({
  path,
  mtimeMs,
  favorited,
  onFavorite,
  onRename,
  onDelete,
}: {
  path: string;
  mtimeMs: number;
  favorited: boolean;
  onFavorite: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="list-row">
      <div>
        <Link to={`/edit/${path}`}>
          <strong>{displayName(path)}</strong>
        </Link>
        <div style={{ color: "var(--ink-soft)", fontSize: "0.8rem" }}>
          {path} · Updated {formatRelativeTime(mtimeMs)}
        </div>
      </div>
      <button type="button" className="btn btn-ghost" onClick={onFavorite}>
        {favorited ? "Unfavorite" : "Favorite"}
      </button>
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button type="button" className="btn btn-ghost" onClick={onRename}>
          Rename
        </button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
