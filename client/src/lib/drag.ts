export const ITEM_DRAG_TYPE = "application/x-nerdgram-path";

/** The slice of a drag event both buttons and cards need to handle. */
export type DragPayload = {
  preventDefault: () => void;
  stopPropagation: () => void;
  dataTransfer: DataTransfer;
};

export type DragItem = {
  path: string;
  type: "file" | "folder";
};

type DirectoryEntry = { isFile: boolean; isDirectory: boolean };

type EntryItem = DataTransferItem & {
  webkitGetAsEntry?: () => DirectoryEntry | null;
};

export function classifyDrag(dataTransfer: DataTransfer): "item" | "files" | "unknown" {
  const types = Array.from(dataTransfer.types);
  if (types.includes(ITEM_DRAG_TYPE)) return "item";
  if (types.includes("Files")) return "files";
  return "unknown";
}

export function writeDragItem(dataTransfer: DataTransfer, item: DragItem): void {
  dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify(item));
  dataTransfer.setData("text/plain", item.path);
  dataTransfer.effectAllowed = "move";
}

export function readDragItem(dataTransfer: DataTransfer): DragItem | null {
  const raw = dataTransfer.getData(ITEM_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DragItem>;
    if (
      (parsed.type === "file" || parsed.type === "folder") &&
      typeof parsed.path === "string" &&
      parsed.path.length > 0
    ) {
      return { path: parsed.path, type: parsed.type };
    }
  } catch {
    return null;
  }
  return null;
}

export function filesFromDataTransfer(dataTransfer: DataTransfer): {
  files: File[];
  sawDirectory: boolean;
} {
  const items = Array.from(dataTransfer.items || []) as EntryItem[];
  let sawDirectory = false;
  const files: File[] = [];
  let usedEntry = false;
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      sawDirectory = true;
      usedEntry = true;
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
      usedEntry = true;
    }
  }
  if (!usedEntry) {
    files.push(...Array.from(dataTransfer.files));
  }
  return { files, sawDirectory };
}
