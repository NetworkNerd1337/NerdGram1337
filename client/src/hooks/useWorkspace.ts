import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { TreeNode } from "../types";

export function useWorkspace() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [treeRes, favRes] = await Promise.all([api.tree(), api.favorites()]);
      setTree(treeRes.tree);
      setFavorites(favRes.favorites);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleFavorite = useCallback(async (path: string) => {
    const result = await api.toggleFavorite(path);
    setFavorites(result.favorites);
    return result.favorited;
  }, []);

  return {
    tree,
    favorites,
    loading,
    error,
    refresh,
    toggleFavorite,
  };
}
