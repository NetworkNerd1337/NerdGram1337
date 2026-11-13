import type { TreeNode } from "../types";

export type TemplateCardFields = {
  id: string;
  title: string;
  description: string;
  tags: readonly string[];
  category: string;
  diagramType: string;
};

export type TemplateFilters = {
  query?: string;
  category?: string;
  diagramType?: string;
  tag?: string;
};

/** Case-insensitive unique labels, sorted for filter menus. */
export function uniqueSorted(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

/**
 * Gallery search. The query matches the name, description, tags, category,
 * diagram type, and id. Category, type, and tag filters are exact (ignoring
 * case) and stack with the query.
 */
export function filterTemplates<T extends TemplateCardFields>(
  templates: readonly T[],
  filters: TemplateFilters,
): T[] {
  const needle = filters.query?.trim().toLowerCase() ?? "";
  const category = filters.category?.trim().toLowerCase() ?? "";
  const diagramType = filters.diagramType?.trim().toLowerCase() ?? "";
  const tag = filters.tag?.trim().toLowerCase() ?? "";
  return templates.filter((template) => {
    if (category && template.category.trim().toLowerCase() !== category) return false;
    if (diagramType && template.diagramType.trim().toLowerCase() !== diagramType) return false;
    if (tag && !template.tags.some((item) => item.trim().toLowerCase() === tag)) return false;
    if (!needle) return true;
    const haystack = [
      template.title,
      template.description,
      template.category,
      template.diagramType,
      template.id,
      ...template.tags,
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function folderInTree(nodes: readonly TreeNode[], target: string): boolean {
  if (!target) return true;
  const walk = (list: readonly TreeNode[]): boolean => {
    for (const node of list) {
      if (node.type === "folder" && node.path === target) return true;
      if (node.children && walk(node.children)) return true;
    }
    return false;
  };
  return walk(nodes);
}

export function templatePresentHref(id: string): string {
  return `/templates/present/${encodeURIComponent(id)}`;
}
