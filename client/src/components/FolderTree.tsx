import type { TreeNode } from "../types";

type FolderTreeProps = {
  nodes: TreeNode[];
  currentPath: string;
  onSelectFolder: (path: string) => void;
  depth?: number;
};

export function FolderTree({
  nodes,
  currentPath,
  onSelectFolder,
  depth = 0,
}: FolderTreeProps) {
  const folders = nodes.filter((n) => n.type === "folder");

  return (
    <div className={depth === 0 ? "tree" : "tree tree-children"}>
      {folders.map((folder) => {
        const active = currentPath === folder.path;
        return (
          <div key={folder.path}>
            <button
              type="button"
              className={`tree-item${active ? " active" : ""}`}
              onClick={() => onSelectFolder(folder.path)}
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
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
