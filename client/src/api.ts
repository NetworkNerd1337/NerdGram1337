import type { FilePayload, FolderListing, TreeNode } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  tree: () => request<{ tree: TreeNode[] }>("/api/tree"),
  list: (path = "") =>
    request<FolderListing>(`/api/list?path=${encodeURIComponent(path)}`),
  readFile: (path: string) =>
    request<FilePayload>(`/api/file?path=${encodeURIComponent(path)}`),
  writeFile: (path: string, content: string) =>
    request<{ path: string; mtimeMs: number; size: number }>("/api/file", {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    }),
  createFolder: (path: string) =>
    request<{ path: string }>("/api/folder", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  rename: (from: string, to: string) =>
    request<{ path: string }>("/api/rename", {
      method: "PATCH",
      body: JSON.stringify({ from, to }),
    }),
  move: (from: string, toFolder: string) =>
    request<{ path: string }>("/api/move", {
      method: "POST",
      body: JSON.stringify({ from, toFolder }),
    }),
  delete: (path: string) =>
    request<void>(`/api/item?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),
  favorites: () => request<{ favorites: string[] }>("/api/favorites"),
  toggleFavorite: (path: string) =>
    request<{ favorites: string[]; favorited: boolean }>(
      "/api/favorites/toggle",
      {
        method: "POST",
        body: JSON.stringify({ path }),
      },
    ),
};
