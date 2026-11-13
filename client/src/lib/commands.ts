/**
 * Command palette registry.
 *
 * Add a fixed command with `registerCommands`, or a list that depends on the
 * workspace with `registerCommandProvider`. Both return an unregister
 * function. Later issues should register here instead of editing the palette:
 *
 * - #13 full search: a provider that returns diagram hits
 * - #17 new from template: `registerCommands` for each template
 * - #18 Present: one command, shortcut Mod-Shift-Enter or F5 (do not bind those here)
 * - #19 check for updates: `registerCommands` from the update module
 *
 * Do not bind F5, Mod-Shift-Enter, or Mod-/. Mod-/ toggles a Mermaid comment.
 * Mod-l stays with the browser address bar. Mod-k opens this palette.
 */

export type CommandRoute = "dashboard" | "editor" | "new" | "reference" | "other";

export type WorkspaceItem = {
  path: string;
  name: string;
  type: "file" | "folder";
  title: string | null;
};

export type TrashCommandItem = {
  id: string;
  name: string;
  type: "file" | "folder";
};

export type ExportFormatName = "svg" | "png" | "jpg" | "pdf";

/**
 * Page actions the built-in commands call. Optional so a screen only fills in
 * what it can do. New features can ignore this and close over their own
 * functions in `registerCommands`.
 */
export type CommandActions = {
  newDiagram?: () => void;
  newFolder?: () => void;
  focusSearch?: () => void;
  importFiles?: () => void;
  openTrash?: () => void;
  emptyTrash?: () => void;
  openDiagram?: (path: string) => void;
  openFolder?: (path: string) => void;
  renameItem?: (path: string, isFolder: boolean) => void;
  moveItem?: (path: string, isFolder: boolean) => void;
  duplicateItem?: (path: string) => void;
  trashItem?: (path: string) => void;
  restoreTrash?: (id: string) => void;
  editDiagramInfo?: () => void;
  openHistory?: () => void;
  setTheme?: (theme: string | null) => void;
  toggleAutoUpdate?: () => void;
  exportAs?: (format: ExportFormatName) => void;
  find?: () => void;
  replace?: () => void;
  gotoLine?: () => void;
};

export type CommandContext = {
  route: CommandRoute;
  query: string;
  navigate: (to: string) => void;
  actions: CommandActions;
  items: WorkspaceItem[];
  trashItems: TrashCommandItem[];
  hasPreview: boolean;
  autoUpdate: boolean;
  readOnly: boolean;
  conflictOpen: boolean;
};

export type CommandHostInput = Omit<CommandContext, "query" | "navigate">;

export const EMPTY_COMMAND_HOST: CommandHostInput = {
  route: "other",
  actions: {},
  items: [],
  trashItems: [],
  hasPreview: false,
  autoUpdate: false,
  readOnly: false,
  conflictOpen: false,
};

export type PaletteCommand = {
  id: string;
  title: string;
  section?: string;
  keywords?: string[];
  /** Shown in the row. The real binding lives with the editor or the palette. */
  shortcut?: string;
  order?: number;
  /** Left out of the list until the query is non-empty. */
  searchOnly?: boolean;
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
};

export type CommandProvider = (ctx: CommandContext) => PaletteCommand[];

const registered: PaletteCommand[] = [];
const providers: CommandProvider[] = [];

export function registerCommands(commands: readonly PaletteCommand[]): () => void {
  registered.push(...commands);
  return () => {
    for (const command of commands) {
      const index = registered.indexOf(command);
      if (index >= 0) registered.splice(index, 1);
    }
  };
}

export function registerCommandProvider(provider: CommandProvider): () => void {
  providers.push(provider);
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) providers.splice(index, 1);
  };
}

export function scoreCommand(command: PaletteCommand, query: string): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const haystack = [command.title, command.section ?? "", ...(command.keywords ?? [])]
    .join("\n")
    .toLowerCase();
  let score = 0;
  let from = 0;
  let streak = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, from);
    if (found < 0) return null;
    const previous = found === 0 ? " " : haystack[found - 1];
    const boundary = previous === " " || previous === "\n" || previous === "/" || previous === "-" || previous === ".";
    score += boundary ? 10 : 2;
    if (found === from) {
      streak += 1;
      score += streak * 3;
    } else {
      streak = 0;
      score -= Math.min(6, found - from);
    }
    from = found + 1;
  }
  if (command.title.toLowerCase().startsWith(needle)) score += 30;
  score -= Math.min(20, Math.floor(command.title.length / 8));
  return score;
}

export function filterCommands(
  commands: readonly PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const needle = query.trim();
  const ranked: { command: PaletteCommand; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    if (!needle && command.searchOnly) return;
    const score = scoreCommand(command, needle);
    if (score == null) return;
    ranked.push({ command, score, index });
  });
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const order = (a.command.order ?? 100) - (b.command.order ?? 100);
    if (order !== 0) return order;
    return a.index - b.index;
  });
  return ranked.map((item) => item.command);
}

export function collectCommands(ctx: CommandContext): PaletteCommand[] {
  const gathered: PaletteCommand[] = [];
  const seen = new Set<string>();
  const push = (command: PaletteCommand) => {
    if (seen.has(command.id)) return;
    if (command.when && !command.when(ctx)) return;
    seen.add(command.id);
    gathered.push(command);
  };
  for (const command of registered) push(command);
  for (const provider of providers) {
    for (const command of provider(ctx)) push(command);
  }
  return filterCommands(gathered, ctx.query);
}

export type ShortcutLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
};

/** Cmd-K on macOS and Ctrl-K elsewhere. Shift and Alt stay free. */
export function isPaletteShortcut(event: ShortcutLike): boolean {
  if (event.repeat || event.altKey || event.shiftKey) return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  return event.key.toLowerCase() === "k";
}

export function formatShortcut(shortcut: string, mac: boolean): string {
  const parts = shortcut.split("-");
  const rawKey = parts.pop() ?? "";
  const key = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
  const mods = parts.map((part) => {
    if (part === "Mod") return mac ? "⌘" : "Ctrl";
    if (part === "Alt") return mac ? "⌥" : "Alt";
    if (part === "Shift") return mac ? "⇧" : "Shift";
    return part;
  });
  return mac ? `${mods.join("")}${key}` : [...mods, key].join("+");
}

export const RESERVED_SHORTCUTS = ["F5", "Mod-Shift-Enter", "Mod-/", "Mod-l", "Mod-k"] as const;
