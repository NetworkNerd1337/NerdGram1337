import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useCommandHost } from "../components/commandPaletteContext";
import { ImportDialog } from "../components/ImportDialog";
import { ItemActions } from "../components/ItemActions";
import { HighlightedText } from "../components/HighlightedText";
import { MermaidThumbnail } from "../components/MermaidThumbnail";
import { Modal } from "../components/Modal";
import { MoveDialog } from "../components/MoveDialog";
import { Sidebar } from "../components/Sidebar";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  classifyDrag,
  filesFromDataTransfer,
  readDragItem,
  writeDragItem,
  type DragItem,
  type DragPayload,
} from "../lib/drag";
import { draftsFromFiles, type ImportDraft } from "../lib/importDrafts";
import {
  collectPaths,
  dropMoveState,
  explainOrganizeError,
  moveBlockReason,
  relocatedFolder,
} from "../lib/organize";
import type { WorkspaceItem } from "../lib/commands";
import { editorHref, searchDiagrams } from "../lib/diagramSearch";
import { diagramHeading } from "../lib/frontMatter";
import {
  basename,
  displayName,
  ensureMmd,
  formatRelativeTime,
  joinPath,
} from "../lib/paths";
import type { DiagramMeta, DiagramSearchHit, TrashItem, TreeNode } from "../types";

type OverTarget =
  | { kind: "folder"; path: string; valid: boolean }
  | { kind: "pane"; valid: boolean };

function sameOver(current: OverTarget | null, next: OverTarget | null): boolean {
  if (current === next) return true;
  if (!current || !next || current.kind !== next.kind || current.valid !== next.valid) return false;
  if (current.kind === "folder" && next.kind === "folder") return current.path === next.path;
  return true;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { tree, favorites, loading, error, refresh, toggleFavorite } = useWorkspace();
  const [folder, setFolder] = useState("");
  const [search, setSearch] = useState("");
  const [namesOnly, setNamesOnly] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<{
    query: string;
    namesOnly: boolean;
    hits: DiagramSearchHit[];
    truncated: boolean;
  } | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [modal, setModal] = useState<
    | null
    | { type: "folder" }
    | { type: "diagram" }
    | { type: "rename"; path: string; isFolder: boolean }
  >(null);
  const [nameValue, setNameValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [collision, setCollision] = useState<{
    id: string;
    path: string;
    suggestedPath?: string;
  } | null>(null);
  const [diagramMeta, setDiagramMeta] = useState<DiagramMeta[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [moveTarget, setMoveTarget] = useState<{ path: string; isFolder: boolean } | null>(null);
  const [importDrafts, setImportDrafts] = useState<ImportDraft[] | null>(null);
  const [importFolder, setImportFolder] = useState("");
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [over, setOver] = useState<OverTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const dragItemRef = useRef<DragItem | null>(null);
  const rejectRef = useRef<string | null>(null);
  const landedRef = useRef(false);
  const taken = useMemo(() => collectPaths(tree), [tree]);
  const takenRef = useRef(taken);
  takenRef.current = taken;

  const loadTrash = async () => {
    const result = await api.trash();
    setTrash(result.items);
  };

  useEffect(() => {
    void loadTrash().catch((err: unknown) => {
      setActionError(err instanceof Error ? err.message : "Could not load trash");
    });
    // Trash is loaded once when the dashboard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.diagramMeta().then(
      (result) => {
        if (!cancelled) setDiagramMeta(result.diagrams);
      },
      () => {
        if (!cancelled) setDiagramMeta([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tree]);

  const metaByPath = useMemo(() => {
    const map = new Map<string, DiagramMeta>();
    for (const item of diagramMeta) map.set(item.path, item);
    return map;
  }, [diagramMeta]);

  const commandItems = useMemo(() => {
    const items: WorkspaceItem[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === "folder") {
          items.push({ path: node.path, name: node.name, type: "folder", title: null });
          if (node.children) walk(node.children);
        } else {
          items.push({
            path: node.path,
            name: node.name,
            type: "file",
            title: metaByPath.get(node.path)?.title ?? null,
          });
        }
      }
    };
    walk(tree);
    return items;
  }, [tree, metaByPath]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of diagramMeta) {
      for (const tag of item.tags) tags.add(tag);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [diagramMeta]);

  const tagAllowed = (itemPath: string) => {
    if (tagFilter.length === 0) return true;
    const tags = metaByPath.get(itemPath)?.tags ?? [];
    return tagFilter.some((tag) => tags.includes(tag));
  };

  const toggleTag = (tag: string) => {
    setTagFilter((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  };

  const folderNodes = useMemo(() => findFolder(tree, folder), [tree, folder]);
  const folders = folderNodes.filter((n) => n.type === "folder");
  const files = folderNodes.filter((n) => n.type === "file");

  const filesByPath = useMemo(() => {
    const map = new Map<string, TreeNode>();
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === "file") map.set(node.path, node);
        else if (node.children) walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setSearchState(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchDiagrams(query, { namesOnly, signal: controller.signal }).then(
        (result) => {
          if (controller.signal.aborted) return;
          setSearchState({
            query,
            namesOnly,
            hits: result.hits,
            truncated: result.truncated,
          });
          setSearching(false);
          setSearchError(null);
        },
        (err: unknown) => {
          if (controller.signal.aborted) return;
          setSearching(false);
          setSearchError(err instanceof Error ? err.message : "Search failed");
        },
      );
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [search, namesOnly, tree]);

  const query = search.trim();
  const freshSearch =
    searchState && searchState.query === query && searchState.namesOnly === namesOnly
      ? searchState
      : null;
  const shownSearch = freshSearch
    ? freshSearch.hits.filter((hit) => tagAllowed(hit.path))
    : null;
  const shownFiles = files.filter((file) => tagAllowed(file.path));

  const openCreateFolder = () => {
    setNameValue("");
    setModal({ type: "folder" });
  };

  const openCreateDiagram = () => {
    setNameValue("Untitled");
    setModal({ type: "diagram" });
  };

  const newFlag = searchParams.get("new");
  useEffect(() => {
    if (newFlag !== "diagram" && newFlag !== "folder") return;
    if (newFlag === "diagram") openCreateDiagram();
    else openCreateFolder();
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
    // Open the same create modals the toolbar buttons use, once per flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFlag]);

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
        await api.writeFile(path, "flowchart TD\n  A[Start] --> B[Edit me]\n");
        await refresh();
        navigate(`/edit/${path}`);
        return;
      } else if (modal.type === "rename") {
        const nextName = modal.isFolder ? nameValue.trim() : ensureMmd(nameValue);
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
    if (!window.confirm(`Move "${displayName(path)}" to the trash? You can restore it later.`)) {
      return;
    }
    setActionError(null);
    try {
      await api.delete(path);
      if (folder === path || folder.startsWith(`${path}/`)) setFolder("");
      await refresh();
      await loadTrash();
    } catch (err) {
      setActionError(explainOrganizeError(err));
    }
  };

  const restoreItem = async (id: string, options?: { path?: string; overwrite?: boolean }) => {
    setActionError(null);
    try {
      await api.restoreTrash(id, options);
      setCollision(null);
      await refresh();
      await loadTrash();
    } catch (err) {
      if (err instanceof ApiError && err.code === "collision") {
        setCollision({
          id,
          path: err.path || "that path",
          suggestedPath: err.suggestedPath,
        });
        return;
      }
      setActionError(err instanceof Error ? err.message : "Restore failed");
    }
  };

  const purgeItem = async (id: string) => {
    if (!window.confirm("Delete this item permanently? This cannot be undone.")) return;
    setActionError(null);
    try {
      await api.purgeTrash(id);
      await loadTrash();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete that item");
    }
  };

  const emptyTrash = async () => {
    if (!window.confirm("Empty the trash? This permanently deletes everything in it.")) return;
    setActionError(null);
    try {
      await api.emptyTrash();
      await loadTrash();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not empty the trash");
    }
  };

  const afterMove = async (from: string, to: string, isFolder: boolean) => {
    setFolder((current) => relocatedFolder(current, from, to, isFolder));
    setMoveTarget(null);
    setActionError(null);
    setStatus(`Moved ${basename(from)} to ${to || "the workspace root"}.`);
    await refresh();
  };

  const commitMove = async (from: string, toFolder: string, isFolder: boolean) => {
    const reason = moveBlockReason(from, isFolder, toFolder);
    if (reason) {
      setStatus(null);
      setActionError(reason);
      return;
    }
    try {
      const result = await api.move(from, toFolder);
      await afterMove(from, result.path, isFolder);
    } catch (err) {
      setStatus(null);
      if (err instanceof ApiError && err.code === "collision") {
        setActionError("That folder already has an item with this name. Use Move to… to keep both.");
        return;
      }
      setActionError(explainOrganizeError(err));
    }
  };

  const duplicateItem = async (itemPath: string) => {
    setActionError(null);
    try {
      const result = await api.duplicate(itemPath);
      setStatus(`Duplicated as ${result.path}.`);
      await refresh();
    } catch (err) {
      setStatus(null);
      setActionError(explainOrganizeError(err));
    }
  };

  const beginImport = async (toFolder: string, picked: File[], sawDirectory: boolean) => {
    if (picked.length === 0) {
      setStatus(null);
      setActionError(
        sawDirectory
          ? "Import individual .mmd, .md, or .txt files. Folders are not imported."
          : "Nothing in that drop can be imported.",
      );
      return;
    }
    try {
      const drafts = await draftsFromFiles(picked);
      setImportFolder(toFolder);
      setImportDrafts(drafts);
      setShowTrash(false);
      setActionError(null);
      setStatus(
        sawDirectory ? "Folders in that drop were skipped. Review the files before importing." : null,
      );
    } catch (err) {
      setStatus(null);
      setActionError(err instanceof Error ? err.message : "Could not read those files.");
    }
  };

  const startDrag = (event: DragEvent, item: DragItem) => {
    dragItemRef.current = item;
    writeDragItem(event.dataTransfer, item);
    setDragPath(item.path);
  };

  const endDrag = () => {
    const reason = rejectRef.current;
    const landed = landedRef.current;
    dragItemRef.current = null;
    rejectRef.current = null;
    landedRef.current = false;
    setDragPath(null);
    setOver(null);
    // A refused drop sets dropEffect to none, so the browser never fires drop.
    // The reason is reported when the drag ends.
    if (!landed && reason) {
      setStatus(null);
      setActionError(reason);
    }
  };

  const kindOf = (dataTransfer: DataTransfer) =>
    dragItemRef.current ? "item" : classifyDrag(dataTransfer);

  const assignOver = (next: OverTarget | null) => {
    setOver((current) => (sameOver(current, next) ? current : next));
  };

  const markFolder = (toFolder: string, event: DragPayload) => {
    const kind = kindOf(event.dataTransfer);
    if (kind === "unknown") return;
    event.preventDefault();
    event.stopPropagation();
    if (kind === "files") {
      event.dataTransfer.dropEffect = "copy";
      rejectRef.current = null;
      assignOver({ kind: "folder", path: toFolder, valid: true });
      return;
    }
    const item = dragItemRef.current;
    if (!item) {
      event.dataTransfer.dropEffect = "none";
      rejectRef.current = "That item cannot be moved.";
      assignOver({ kind: "folder", path: toFolder, valid: false });
      return;
    }
    const decision = dropMoveState(item, toFolder, takenRef.current);
    event.dataTransfer.dropEffect = decision.ok ? "move" : "none";
    rejectRef.current = decision.ok ? null : decision.reason;
    assignOver({ kind: "folder", path: toFolder, valid: decision.ok });
  };

  const dropOnFolder = (toFolder: string, event: DragPayload) => {
    const kind = kindOf(event.dataTransfer);
    if (kind === "unknown") return;
    landedRef.current = true;
    event.preventDefault();
    event.stopPropagation();
    setOver(null);
    if (kind === "files") {
      const { files, sawDirectory } = filesFromDataTransfer(event.dataTransfer);
      void beginImport(toFolder, files, sawDirectory);
      return;
    }
    const item = dragItemRef.current ?? readDragItem(event.dataTransfer);
    dragItemRef.current = null;
    setDragPath(null);
    if (!item) return;
    const decision = dropMoveState(item, toFolder, takenRef.current);
    if (!decision.ok) {
      setStatus(null);
      setActionError(decision.reason);
      return;
    }
    void commitMove(item.path, toFolder, item.type === "folder");
  };

  const markPane = (event: DragEvent<HTMLElement>) => {
    const kind = kindOf(event.dataTransfer);
    if (kind === "unknown") return;
    event.preventDefault();
    event.stopPropagation();
    if (showTrash) {
      event.dataTransfer.dropEffect = "none";
      rejectRef.current = "Trash is not a drop target.";
      assignOver(null);
      return;
    }
    if (kind === "files") {
      event.dataTransfer.dropEffect = "copy";
      rejectRef.current = null;
      assignOver({ kind: "pane", valid: true });
      return;
    }
    const item = dragItemRef.current;
    if (!item) {
      event.dataTransfer.dropEffect = "none";
      rejectRef.current = "That item cannot be moved.";
      assignOver({ kind: "pane", valid: false });
      return;
    }
    const decision = dropMoveState(item, folder, takenRef.current);
    event.dataTransfer.dropEffect = decision.ok ? "move" : "none";
    rejectRef.current = decision.ok ? null : decision.reason;
    assignOver({ kind: "pane", valid: decision.ok });
  };

  const dropOnPane = (event: DragEvent<HTMLElement>) => {
    if (kindOf(event.dataTransfer) === "unknown") return;
    landedRef.current = true;
    event.preventDefault();
    event.stopPropagation();
    if (showTrash) {
      setStatus(null);
      setActionError("Trash is not a drop target.");
      setOver(null);
      return;
    }
    dropOnFolder(folder, event);
  };

  const rejectFileDrop = (event: DragPayload) => {
    if (kindOf(event.dataTransfer) !== "item") return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "none";
    rejectRef.current = "Drop onto a folder. Diagrams are not drop targets.";
  };

  const dropOnFile = (event: DragPayload) => {
    if (kindOf(event.dataTransfer) !== "item") return;
    landedRef.current = true;
    event.preventDefault();
    event.stopPropagation();
    setOver(null);
    setStatus(null);
    setActionError("Drop onto a folder. Diagrams are not drop targets.");
  };

  useCommandHost({
    route: "dashboard",
    actions: {
      newDiagram: openCreateDiagram,
      newFolder: openCreateFolder,
      focusSearch: () => document.getElementById("diagram-search")?.focus(),
      importFiles: () => fileInputRef.current?.click(),
      openTrash: () => {
        setShowTrash(true);
        setSearch("");
      },
      emptyTrash: () => {
        void emptyTrash();
      },
      openDiagram: (path) => navigate(`/edit/${path}`),
      openFolder: (path) => {
        setShowTrash(false);
        setFolder(path);
      },
      renameItem: openRename,
      moveItem: (path, isFolder) => setMoveTarget({ path, isFolder }),
      duplicateItem: (itemPath) => {
        void duplicateItem(itemPath);
      },
      trashItem: (path) => {
        void handleDelete(path);
      },
      restoreTrash: (id) => {
        void restoreItem(id);
      },
    },
    items: commandItems,
    trashItems: trash.map((item) => ({ id: item.id, name: item.name, type: item.type })),
    hasPreview: false,
    autoUpdate: false,
    readOnly: false,
    conflictOpen: false,
  });

  const folderHighlight =
    over?.kind === "folder" ? { path: over.path, valid: over.valid } : null;
  const title = folder ? displayName(folder) : "Dashboard";
  const paneClass = over?.kind === "pane" ? (over.valid ? " drop-valid" : " drop-invalid") : "";

  return (
    <div className="app-shell">
      <Sidebar
        tree={tree}
        favorites={favorites}
        currentFolder={showTrash ? "__trash__" : folder}
        search={search}
        namesOnly={namesOnly}
        onNamesOnly={setNamesOnly}
        onSearch={(value) => {
          setSearch(value);
          if (value.trim()) setShowTrash(false);
        }}
        onSelectFolder={(path) => {
          setShowTrash(false);
          setFolder(path);
        }}
        trashCount={trash.length}
        trashActive={showTrash}
        onOpenTrash={() => {
          setShowTrash(true);
          setSearch("");
        }}
        dropHighlight={folderHighlight}
        onFolderDragOver={markFolder}
        onFolderDrop={dropOnFolder}
        onTrashDragOver={(event) => {
          if (kindOf(event.dataTransfer) === "unknown") return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "none";
          rejectRef.current = "Trash is not a drop target.";
        }}
        onTrashDrop={(event) => {
          if (kindOf(event.dataTransfer) === "unknown") return;
          landedRef.current = true;
          event.preventDefault();
          event.stopPropagation();
          setOver(null);
          setStatus(null);
          setActionError("Trash is not a drop target.");
        }}
      />
      <main className={`main${paneClass}`} onDragOver={markPane} onDrop={dropOnPane}>
        <div className="page-header">
          <h1>{showTrash ? "Trash" : search.trim() ? "Search" : title}</h1>
          <Link className="btn btn-ghost" to="/new">
            Paste Mermaid
          </Link>
        </div>

        <div aria-live="polite">
          {(error || actionError) && <div className="error-banner">{actionError || error}</div>}
          {status && !actionError ? <div className="status-banner">{status}</div> : null}
        </div>
        <p id="drag-help" className="sr-only">
          Drag a diagram or folder onto a folder to move it. Move to… does the same thing from the
          keyboard. Dropping .mmd, .md, or .txt files imports them. Trash is not a drop target.
        </p>

        <div className="toolbar">
          {showTrash ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void emptyTrash()}
              disabled={trash.length === 0}
            >
              Empty trash
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={openCreateDiagram}>
                New diagram
              </button>
              <button type="button" className="btn btn-ghost" onClick={openCreateFolder}>
                New folder
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
                Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mmd,.md,.txt,text/plain,text/markdown"
                multiple
                hidden
                aria-label="Import diagram files"
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (picked.length === 0) return;
                  void beginImport(folder, picked, false);
                }}
              />
            </>
          )}
          {!showTrash && (
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
          )}
        </div>

        {loading ? <p>Loading workspace…</p> : null}
        {!showTrash && allTags.length > 0 && (
          <div className="tag-filter" role="group" aria-label="Filter by tag">
            <button
              type="button"
              className={tagFilter.length === 0 ? "active" : ""}
              onClick={() => setTagFilter([])}
            >
              All tags
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={tagFilter.includes(tag) ? "active" : ""}
                aria-pressed={tagFilter.includes(tag)}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        {dragPath ? (
          <p className="drop-hint">Drop on a folder to move. A highlighted folder can take the item.</p>
        ) : null}

        {showTrash ? (
          <TrashList
            items={trash}
            onRestore={(id) => void restoreItem(id)}
            onPurge={(id) => void purgeItem(id)}
          />
        ) : query ? (
          <>
            <div className="section-title">
              {shownSearch
                ? `${shownSearch.length} match${shownSearch.length === 1 ? "" : "es"}`
                : "Searching…"}
              {freshSearch?.truncated ? " Showing the first matches." : ""}
            </div>
            {searchError ? <div className="error-banner">{searchError}</div> : null}
            {searching && !shownSearch ? <p>Searching…</p> : null}
            {shownSearch && shownSearch.length === 0 ? (
              <div className="empty-state">No diagrams match that search.</div>
            ) : null}
            {shownSearch && shownSearch.length > 0 && view === "grid" ? (
              <div className="card-grid">
                {shownSearch.map((hit) => (
                  <DiagramCard
                    key={hit.path}
                    path={hit.path}
                    href={editorHref(hit.path, hit.line, query)}
                    match={hit}
                    meta={metaByPath.get(hit.path)}
                    onTag={toggleTag}
                    mtimeMs={filesByPath.get(hit.path)?.mtimeMs ?? 0}
                    favorited={favorites.includes(hit.path)}
                    dragging={dragPath === hit.path}
                    onDragStart={(event) => startDrag(event, { path: hit.path, type: "file" })}
                    onDragEnd={endDrag}
                    onDragOver={rejectFileDrop}
                    onDrop={dropOnFile}
                    onFavorite={() => void toggleFavorite(hit.path)}
                    onRename={() => openRename(hit.path, false)}
                    onMove={() => setMoveTarget({ path: hit.path, isFolder: false })}
                    onDuplicate={() => void duplicateItem(hit.path)}
                    onDelete={() => void handleDelete(hit.path)}
                  />
                ))}
              </div>
            ) : null}
            {shownSearch && shownSearch.length > 0 && view === "list" ? (
              <div className="list-view">
                {shownSearch.map((hit) => (
                  <ListRow
                    key={hit.path}
                    path={hit.path}
                    href={editorHref(hit.path, hit.line, query)}
                    match={hit}
                    meta={metaByPath.get(hit.path)}
                    onTag={toggleTag}
                    mtimeMs={filesByPath.get(hit.path)?.mtimeMs ?? 0}
                    favorited={favorites.includes(hit.path)}
                    dragging={dragPath === hit.path}
                    onDragStart={(event) => startDrag(event, { path: hit.path, type: "file" })}
                    onDragEnd={endDrag}
                    onDragOver={rejectFileDrop}
                    onDrop={dropOnFile}
                    onFavorite={() => void toggleFavorite(hit.path)}
                    onRename={() => openRename(hit.path, false)}
                    onMove={() => setMoveTarget({ path: hit.path, isFolder: false })}
                    onDuplicate={() => void duplicateItem(hit.path)}
                    onDelete={() => void handleDelete(hit.path)}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            {folders.length > 0 && (
              <>
                <div className="section-title">Folders</div>
                <div className="card-grid">
                  {folders.map((item) => {
                    const highlighted = over?.kind === "folder" && over.path === item.path;
                    return (
                      <FolderCard
                        key={item.path}
                        node={item}
                        dragging={dragPath === item.path}
                        dropClass={highlighted ? (over.valid ? " drop-valid" : " drop-invalid") : ""}
                        onOpen={() => setFolder(item.path)}
                        onDragStart={(event) => startDrag(event, { path: item.path, type: "folder" })}
                        onDragEnd={endDrag}
                        onDragOver={(event) => markFolder(item.path, event)}
                        onDrop={(event) => dropOnFolder(item.path, event)}
                        onRename={() => openRename(item.path, true)}
                        onMove={() => setMoveTarget({ path: item.path, isFolder: true })}
                        onDuplicate={() => void duplicateItem(item.path)}
                        onDelete={() => void handleDelete(item.path)}
                      />
                    );
                  })}
                </div>
              </>
            )}

            <div className="section-title">Diagrams</div>
            {shownFiles.length === 0 ? (
              <div className="empty-state">
                {tagFilter.length > 0 && files.length > 0
                  ? "No diagrams with the selected tags."
                  : "No diagrams here yet. Create one, import a .mmd file, or paste Mermaid markdown."}
              </div>
            ) : view === "grid" ? (
              <div className="card-grid">
                {shownFiles.map((file) => (
                  <DiagramCard
                    key={file.path}
                    path={file.path}
                    meta={metaByPath.get(file.path)}
                    onTag={toggleTag}
                    mtimeMs={file.mtimeMs}
                    favorited={favorites.includes(file.path)}
                    dragging={dragPath === file.path}
                    onDragStart={(event) => startDrag(event, { path: file.path, type: "file" })}
                    onDragEnd={endDrag}
                    onDragOver={rejectFileDrop}
                    onDrop={dropOnFile}
                    onFavorite={() => void toggleFavorite(file.path)}
                    onRename={() => openRename(file.path, false)}
                    onMove={() => setMoveTarget({ path: file.path, isFolder: false })}
                    onDuplicate={() => void duplicateItem(file.path)}
                    onDelete={() => void handleDelete(file.path)}
                  />
                ))}
              </div>
            ) : (
              <div className="list-view">
                {shownFiles.map((file) => (
                  <ListRow
                    key={file.path}
                    path={file.path}
                    meta={metaByPath.get(file.path)}
                    onTag={toggleTag}
                    mtimeMs={file.mtimeMs}
                    favorited={favorites.includes(file.path)}
                    dragging={dragPath === file.path}
                    onDragStart={(event) => startDrag(event, { path: file.path, type: "file" })}
                    onDragEnd={endDrag}
                    onDragOver={rejectFileDrop}
                    onDrop={dropOnFile}
                    onFavorite={() => void toggleFavorite(file.path)}
                    onRename={() => openRename(file.path, false)}
                    onMove={() => setMoveTarget({ path: file.path, isFolder: false })}
                    onDuplicate={() => void duplicateItem(file.path)}
                    onDelete={() => void handleDelete(file.path)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {collision && (
        <div className="modal-backdrop" role="presentation" onClick={() => setCollision(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-collision-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="restore-collision-title">That path is taken</h3>
            <p>
              Something is already at <strong>{collision.path}</strong>. You can restore a copy
              beside it, or replace it. Replacing moves the current item to the trash.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setCollision(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void restoreItem(collision.id, { overwrite: true })}
              >
                Replace
              </button>
              {collision.suggestedPath && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void restoreItem(collision.id, { path: collision.suggestedPath })}
                >
                  Restore as {displayName(collision.suggestedPath)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <Modal
          title={
            modal.type === "folder" ? "New folder" : modal.type === "diagram" ? "New diagram" : "Rename"
          }
          confirmLabel={modal.type === "rename" ? "Rename" : "Create"}
          onClose={() => setModal(null)}
          onConfirm={() => void handleConfirm()}
        >
          <label htmlFor="name-input">{modal.type === "folder" ? "Folder name" : "Diagram name"}</label>
          <input
            id="name-input"
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            placeholder={modal.type === "folder" ? "Projects" : "Untitled"}
          />
        </Modal>
      )}

      {moveTarget ? (
        <MoveDialog
          itemPath={moveTarget.path}
          isFolder={moveTarget.isFolder}
          tree={tree}
          initialFolder={folder}
          onClose={() => setMoveTarget(null)}
          onMoved={(from, to) => void afterMove(from, to, moveTarget.isFolder)}
        />
      ) : null}

      {importDrafts ? (
        <ImportDialog
          tree={tree}
          folder={importFolder}
          drafts={importDrafts}
          onFolderChange={setImportFolder}
          onClose={() => setImportDrafts(null)}
          onDone={(message, close) => {
            setStatus(message);
            setActionError(null);
            void refresh();
            if (close) setImportDrafts(null);
          }}
        />
      ) : null}
    </div>
  );
}

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

function TrashList({
  items,
  onRestore,
  onPurge,
}: {
  items: TrashItem[];
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
}) {
  if (items.length === 0) {
    return <div className="empty-state">Trash is empty.</div>;
  }
  return (
    <div className="list-view">
      {items.map((item) => (
        <div key={item.id} className="list-row">
          <div>
            <strong>{item.name}</strong>
            <div style={{ color: "var(--ink-soft)", fontSize: "0.8rem" }}>
              {item.type === "folder" ? "Folder" : "Diagram"} · {item.originalPath} ·{" "}
              {new Date(item.deletedAt).toLocaleString()}
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => onRestore(item.id)}>
            Restore
          </button>
          <button type="button" className="btn btn-danger" onClick={() => onPurge(item.id)}>
            Delete permanently
          </button>
        </div>
      ))}
    </div>
  );
}

function SearchMatch({ hit }: { hit: DiagramSearchHit }) {
  const fileMatch = hit.field === "filename" || hit.field === "path";
  return (
    <p className="search-snippet">
      <span className={fileMatch ? "match-chip file" : "match-chip"}>{hit.label}</span>
      <HighlightedText text={hit.snippet} start={hit.matchStart} length={hit.matchLength} />
    </p>
  );
}

function DiagramCard({
  path,
  href = `/edit/${path}`,
  match,
  meta,
  onTag,
  mtimeMs,
  favorited,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onFavorite,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
}: {
  path: string;
  href?: string;
  match?: DiagramSearchHit;
  meta?: DiagramMeta;
  onTag: (tag: string) => void;
  mtimeMs: number;
  favorited: boolean;
  dragging: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragPayload) => void;
  onDrop: (event: DragPayload) => void;
  onFavorite: () => void;
  onRename: () => void;
  onMove: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const label = diagramHeading(meta?.title ?? match?.title, path);
  return (
    <article
      className={`card${dragging ? " is-dragging" : ""}`}
      draggable
      aria-describedby="drag-help"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Link to={href} draggable={false} aria-label={`Open ${label}`}>
        <MermaidThumbnail path={path} mtimeMs={mtimeMs} cacheKey={meta?.cacheKey ?? null} />
      </Link>
      <div className="card-body">
        <h3>
          <Link to={href} draggable={false}>
            {label}
          </Link>
        </h3>
        {match ? <SearchMatch hit={match} /> : null}
        {meta?.description && match?.field !== "description" ? (
          <p className="card-description">{meta.description}</p>
        ) : null}
        {meta?.malformed ? <p className="card-description">Front matter needs a fix</p> : null}
        <TagList tags={meta?.tags ?? []} onTag={onTag} />
        <p>Updated {formatRelativeTime(mtimeMs)}</p>
        <ItemActions
          label={label}
          favorited={favorited}
          onFavorite={onFavorite}
          onRename={onRename}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
    </article>
  );
}

function ListRow({
  path,
  href = `/edit/${path}`,
  match,
  meta,
  onTag,
  mtimeMs,
  favorited,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onFavorite,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
}: {
  path: string;
  href?: string;
  match?: DiagramSearchHit;
  meta?: DiagramMeta;
  onTag: (tag: string) => void;
  mtimeMs: number;
  favorited: boolean;
  dragging: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragPayload) => void;
  onDrop: (event: DragPayload) => void;
  onFavorite: () => void;
  onRename: () => void;
  onMove: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const label = diagramHeading(meta?.title ?? match?.title, path);
  const fileLabel = displayName(path);
  return (
    <div
      className={`list-row${dragging ? " is-dragging" : ""}`}
      draggable
      aria-describedby="drag-help"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="list-row-main">
        <Link to={href} draggable={false}>
          <strong>{label}</strong>
        </Link>
        {match ? <SearchMatch hit={match} /> : null}
        {meta?.description && match?.field !== "description" ? (
          <div className="card-description">{meta.description}</div>
        ) : null}
        <TagList tags={meta?.tags ?? []} onTag={onTag} />
        <div style={{ color: "var(--ink-soft)", fontSize: "0.8rem" }}>
          {label === fileLabel ? path : fileLabel} · Updated {formatRelativeTime(mtimeMs)}
          {meta?.malformed ? " · Front matter needs a fix" : ""}
        </div>
      </div>
      <ItemActions
        label={label}
        favorited={favorited}
        onFavorite={onFavorite}
        onRename={onRename}
        onMove={onMove}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </div>
  );
}

function TagList({ tags, onTag }: { tags: string[]; onTag: (tag: string) => void }) {
  if (tags.length === 0) return null;
  return (
    <div className="tag-row">
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          className="tag-chip"
          draggable={false}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onTag(tag);
          }}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}

function FolderCard({
  node,
  dragging,
  dropClass,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
}: {
  node: TreeNode;
  dragging: boolean;
  dropClass: string;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragPayload) => void;
  onDrop: (event: DragPayload) => void;
  onRename: () => void;
  onMove: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const suppressClick = useRef(false);
  const count = (node.children || []).filter((child) => child.type === "file").length;
  return (
    <article
      className={`card folder-card${dragging ? " is-dragging" : ""}${dropClass}`}
      draggable
      aria-describedby="drag-help"
      onDragStart={(event) => {
        suppressClick.current = true;
        onDragStart(event);
      }}
      onDragEnd={() => {
        onDragEnd();
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="folder-open"
        onClick={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
            return;
          }
          onOpen();
        }}
      >
        <h3>
          <span className="folder-glyph" aria-hidden="true" />
          {node.name}
        </h3>
        <p>
          {count} diagram{count === 1 ? "" : "s"}
        </p>
      </button>
      <div className="card-body">
        <ItemActions
          label={node.name}
          onRename={onRename}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
    </article>
  );
}
