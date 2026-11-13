import { displayName } from "./paths";

export {
  applyDiagramPatch,
  diagramConfigKey,
  diagramInitConfig,
  diagramMetaFrom,
  diagramSearchRank,
  matchFrontMatter,
  migrateInitDirectives,
  parseDiagram,
  thumbnailCacheKey,
  DEFAULT_FONT_FAMILY,
  ELK_NODE_PLACEMENTS,
  FALLBACK_THEME,
  FLOWCHART_CURVES,
  MERMAID_LAYOUTS,
  MERMAID_LOOKS,
  MERMAID_THEMES,
} from "../../../server/src/frontMatter.ts";

export type {
  ApplyResult,
  DiagramDocument,
  DiagramMeta,
  DiagramPatch,
  DiagramSearchFields,
  MigrateResult,
  Scalar,
} from "../../../server/src/frontMatter.ts";

const THEME_LABELS: Record<string, string> = {
  default: "Default",
  neutral: "Neutral",
  dark: "Dark",
  forest: "Forest",
  base: "Base",
  neo: "Neo",
  "neo-dark": "Neo dark",
  redux: "Redux",
  "redux-dark": "Redux dark",
  "redux-color": "Redux color",
  "redux-dark-color": "Redux dark color",
};

export function themeLabel(theme: string): string {
  return THEME_LABELS[theme] ?? theme;
}

/** Front matter title when the file has one, otherwise the file name. */
export function diagramHeading(title: string | null | undefined, path: string): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : displayName(path);
}
