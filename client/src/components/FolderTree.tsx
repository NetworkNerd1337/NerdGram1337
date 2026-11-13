import type { DragPayload } from "../lib/drag";
import type { TreeNode } from "../types";

type FolderTreeProps = {
  nodes: TreeNode[];
  currentPath: string;
  onSelectFolder: (path: string) => void;
  depth?: number;
  dropHighlight?: { path: string; valid: boolean } | null;
  onFolderDragOver?: (path: string, event: DragPayload) => void;
  onFolderDrop?: (path: string, event: DragPayload) => void;
};

export function FolderTree({
  nodes,
  currentPath,
  onSelectFolder,
  depth = 0,
  dropHighlight = null,
  onFolderDragOver,
  onFolderDrop,
}: FolderTreeProps) {
  const folders = nodes.filter((n) => n.type === "folder");

  return (
    <div className={depth === 0 ? "tree" : "tree tree-children"}>
      {folders.map((folder) => {
        const active = currentPath === folder.path;
        const highlighted = dropHighlight?.path === folder.path;
        const dropClass = highlighted ? (dropHighlight?.valid ? " drop-valid" : " drop-invalid") : "";
        return (
          <div key={folder.path}>
            <button
              type="button"
              className={`tree-item${active ? " active" : ""}${dropClass}`}
              onClick={() => onSelectFolder(folder.path)}
              onDragOver={
                onFolderDragOver ? (event) => onFolderDragOver(folder.path, event) : undefined
              }
              onDrop={onFolderDrop ? (event) => onFolderDrop(folder.path, event) : undefined}
            >
              <span className="folder-glyph" aria-hidden="true" />
              <span>{folder.name}</span>
            </button>
            {folder.children && folder.children.length > 0 ? (
              <FolderTree
                nodes={folder.children}
                currentPath={currentPath}
                onSelectFolder={onSelectFolder}
                depth={depth + 1}
                dropHighlight={dropHighlight}
                onFolderDragOver={onFolderDragOver}
                onFolderDrop={onFolderDrop}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
