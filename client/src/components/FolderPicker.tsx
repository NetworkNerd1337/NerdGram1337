import type { KeyboardEvent } from "react";
import type { TreeNode } from "../types";

type FolderPickerProps = {
  tree: TreeNode[];
  value: string;
  onChange: (path: string) => void;
  disabledReason?: (path: string) => string | null;
};

export function FolderPicker({ tree, value, onChange, disabledReason }: FolderPickerProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([aria-disabled="true"])'),
    );
    if (buttons.length === 0) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = current <= 0 ? buttons.length - 1 : current - 1;
    else if (event.key === "Home") next = 0;
    else next = buttons.length - 1;
    const button = buttons[next];
    if (!button) return;
    button.focus();
    onChange(button.dataset.path ?? "");
  };

  return (
    <div
      className="folder-picker"
      role="radiogroup"
      aria-label="Destination folder"
      onKeyDown={onKeyDown}
    >
      <FolderChoice
        path=""
        label="Workspace root"
        depth={0}
        selected={value === ""}
        reason={disabledReason?.("") ?? null}
        onChange={onChange}
      />
      <FolderChoices
        nodes={tree}
        depth={0}
        value={value}
        disabledReason={disabledReason}
        onChange={onChange}
      />
    </div>
  );
}

function FolderChoices({
  nodes,
  depth,
  value,
  disabledReason,
  onChange,
}: {
  nodes: TreeNode[];
  depth: number;
  value: string;
  disabledReason?: (path: string) => string | null;
  onChange: (path: string) => void;
}) {
  const folders = nodes.filter((node) => node.type === "folder");
  return (
    <>
      {folders.map((folder) => (
        <div key={folder.path}>
          <FolderChoice
            path={folder.path}
            label={folder.name}
            depth={depth + 1}
            selected={value === folder.path}
            reason={disabledReason?.(folder.path) ?? null}
            onChange={onChange}
          />
          {folder.children && folder.children.length > 0 ? (
            <FolderChoices
              nodes={folder.children}
              depth={depth + 1}
              value={value}
              disabledReason={disabledReason}
              onChange={onChange}
            />
          ) : null}
        </div>
      ))}
    </>
  );
}

function FolderChoice({
  path,
  label,
  depth,
  selected,
  reason,
  onChange,
}: {
  path: string;
  label: string;
  depth: number;
  selected: boolean;
  reason: string | null;
  onChange: (path: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-path={path}
      className={`picker-item${selected ? " selected" : ""}${reason ? " is-disabled" : ""}`}
      style={{ paddingLeft: `${0.55 + depth * 0.85}rem` }}
      aria-disabled={reason ? true : undefined}
      title={reason ?? undefined}
      onClick={() => {
        if (reason) return;
        onChange(path);
      }}
    >
      <span className="folder-glyph" aria-hidden="true" />
      <span>{label}</span>
      {reason ? <span className="picker-reason">{reason}</span> : null}
    </button>
  );
}
