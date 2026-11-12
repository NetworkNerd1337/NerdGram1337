export function joinPath(folder: string, name: string): string {
  if (!folder) return name;
  return `${folder.replace(/\/+$/, "")}/${name.replace(/^\/+/, "")}`;
}

export function parentPath(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function basename(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

export function ensureMmd(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Untitled.mmd";
  return trimmed.toLowerCase().endsWith(".mmd") ? trimmed : `${trimmed}.mmd`;
}

export function displayName(filePath: string): string {
  return basename(filePath).replace(/\.mmd$/i, "");
}

export function formatRelativeTime(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "a few seconds ago";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const month = Math.round(day / 30);
  return `${month} month${month === 1 ? "" : "s"} ago`;
}

export function flattenFiles(
  nodes: { path: string; type: string; name: string; mtimeMs: number; children?: unknown[] }[],
): { path: string; name: string; mtimeMs: number }[] {
  const out: { path: string; name: string; mtimeMs: number }[] = [];
  const walk = (
    list: { path: string; type: string; name: string; mtimeMs: number; children?: unknown[] }[],
  ) => {
    for (const node of list) {
      if (node.type === "file") {
        out.push({ path: node.path, name: node.name, mtimeMs: node.mtimeMs });
      } else if (Array.isArray(node.children)) {
        walk(
          node.children as {
            path: string;
            type: string;
            name: string;
            mtimeMs: number;
            children?: unknown[];
          }[],
        );
      }
    }
  };
  walk(nodes);
  return out;
}
