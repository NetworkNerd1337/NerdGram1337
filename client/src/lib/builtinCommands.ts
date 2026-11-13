import { MERMAID_THEMES, themeLabel } from "./frontMatter";
import { FIND_SHORTCUT, GO_TO_LINE_SHORTCUT } from "./editorCommands";
import {
  registerCommandProvider,
  registerCommands,
  type CommandContext,
  type PaletteCommand,
} from "./commands";

function labelFor(name: string, title: string | null): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  return name.replace(/\.mmd$/i, "");
}

function editorReady(ctx: CommandContext): boolean {
  return ctx.route === "editor" && !ctx.conflictOpen;
}

const builtin: PaletteCommand[] = [
  {
    id: "file.new",
    title: "New diagram",
    section: "File",
    keywords: ["create", "untitled"],
    order: 10,
    run: (ctx) => {
      if (ctx.actions.newDiagram) ctx.actions.newDiagram();
      else ctx.navigate("/?new=diagram");
    },
  },
  {
    id: "file.paste",
    title: "Paste Mermaid",
    section: "File",
    keywords: ["new", "import text"],
    order: 20,
    run: (ctx) => ctx.navigate("/new"),
  },
  {
    id: "file.folder",
    title: "New folder",
    section: "File",
    keywords: ["create", "directory"],
    order: 30,
    run: (ctx) => {
      if (ctx.actions.newFolder) ctx.actions.newFolder();
      else ctx.navigate("/?new=folder");
    },
  },
  {
    id: "file.import",
    title: "Import diagrams",
    section: "File",
    keywords: ["upload", "mmd", "markdown"],
    order: 40,
    when: (ctx) => ctx.route === "dashboard" && !!ctx.actions.importFiles,
    run: (ctx) => ctx.actions.importFiles?.(),
  },
  {
    id: "nav.search",
    title: "Search diagrams",
    section: "Navigate",
    keywords: ["filter", "find", "title", "tags"],
    order: 50,
    when: (ctx) => ctx.route === "dashboard" && !!ctx.actions.focusSearch,
    run: (ctx) => ctx.actions.focusSearch?.(),
  },
  {
    id: "nav.trash",
    title: "Open trash",
    section: "Navigate",
    keywords: ["deleted", "restore"],
    order: 60,
    when: (ctx) => ctx.route === "dashboard" && !!ctx.actions.openTrash,
    run: (ctx) => ctx.actions.openTrash?.(),
  },
  {
    id: "nav.emptyTrash",
    title: "Empty trash",
    section: "Navigate",
    keywords: ["purge", "delete permanently"],
    order: 70,
    searchOnly: true,
    when: (ctx) => ctx.route === "dashboard" && !!ctx.actions.emptyTrash,
    run: (ctx) => ctx.actions.emptyTrash?.(),
  },
  {
    id: "nav.reference",
    title: "Open Syntax Reference Library",
    section: "Navigate",
    keywords: ["docs", "mermaid", "help"],
    order: 80,
    run: (ctx) => ctx.navigate("/reference"),
  },
  {
    id: "nav.dashboard",
    title: "Go to dashboard",
    section: "Navigate",
    keywords: ["home", "diagrams"],
    order: 90,
    when: (ctx) => ctx.route !== "dashboard",
    run: (ctx) => ctx.navigate("/"),
  },
  {
    id: "editor.find",
    title: "Find",
    section: "Editor",
    keywords: ["search", "regex"],
    shortcut: FIND_SHORTCUT,
    order: 100,
    when: (ctx) => ctx.route === "editor" && !!ctx.actions.find,
    run: (ctx) => ctx.actions.find?.(),
  },
  {
    id: "editor.replace",
    title: "Replace",
    section: "Editor",
    keywords: ["find", "replace all", "regex"],
    order: 110,
    when: (ctx) => ctx.route === "editor" && !!ctx.actions.replace,
    run: (ctx) => ctx.actions.replace?.(),
  },
  {
    id: "editor.gotoLine",
    title: "Go to line",
    section: "Editor",
    keywords: ["jump", "column"],
    shortcut: GO_TO_LINE_SHORTCUT,
    order: 120,
    when: (ctx) => ctx.route === "editor" && !!ctx.actions.gotoLine,
    run: (ctx) => ctx.actions.gotoLine?.(),
  },
  {
    id: "editor.info",
    title: "Edit diagram info",
    section: "Editor",
    keywords: ["title", "tags", "notes", "description"],
    order: 130,
    when: (ctx) => ctx.route === "editor" && !!ctx.actions.editDiagramInfo,
    run: (ctx) => ctx.actions.editDiagramInfo?.(),
  },
  {
    id: "editor.history",
    title: "History",
    section: "Editor",
    keywords: ["revisions", "restore"],
    order: 140,
    when: (ctx) => ctx.route === "editor" && !!ctx.actions.openHistory,
    run: (ctx) => ctx.actions.openHistory?.(),
  },
  {
    id: "editor.autoUpdate",
    title: "Toggle Auto-Update",
    section: "Preview",
    keywords: ["preview", "live"],
    order: 150,
    when: (ctx) => ctx.route === "editor" && !!ctx.actions.toggleAutoUpdate,
    run: (ctx) => ctx.actions.toggleAutoUpdate?.(),
  },
  ...(["svg", "png", "jpg", "pdf"] as const).map(
    (format, index): PaletteCommand => ({
      id: `editor.export.${format}`,
      title: `Export as ${format.toUpperCase()}`,
      section: "Export",
      keywords: ["download", "save", format],
      order: 160 + index,
      when: (ctx) => editorReady(ctx) && ctx.hasPreview && !!ctx.actions.exportAs,
      run: (ctx) => ctx.actions.exportAs?.(format),
    }),
  ),
  {
    id: "editor.theme.default",
    title: "Use the app default theme",
    section: "Preview",
    keywords: ["theme", "dark"],
    searchOnly: true,
    when: (ctx) => editorReady(ctx) && !ctx.readOnly && !!ctx.actions.setTheme,
    run: (ctx) => ctx.actions.setTheme?.(null),
  },
  ...MERMAID_THEMES.map(
    (theme): PaletteCommand => ({
      id: `editor.theme.${theme}`,
      title: `Set theme to ${themeLabel(theme)}`,
      section: "Preview",
      keywords: ["theme", "preview", theme],
      searchOnly: true,
      when: (ctx) => editorReady(ctx) && !ctx.readOnly && !!ctx.actions.setTheme,
      run: (ctx) => ctx.actions.setTheme?.(theme),
    }),
  ),
];

registerCommands(builtin);

registerCommandProvider((ctx) => {
  if (ctx.route !== "dashboard") return [];
  const commands: PaletteCommand[] = [];
  for (const item of ctx.items) {
    const label = labelFor(item.name, item.title);
    const keywords = [item.path, item.name, item.title ?? ""].filter((part) => part.length > 0);
    if (item.type === "folder") {
      commands.push({
        id: `open:${item.path}`,
        title: `Open folder ${label}`,
        keywords,
        section: "Open",
        searchOnly: true,
        when: (host) => !!host.actions.openFolder,
        run: (host) => host.actions.openFolder?.(item.path),
      });
    } else {
      commands.push({
        id: `open:${item.path}`,
        title: `Open ${label}`,
        keywords,
        section: "Open",
        searchOnly: true,
        when: (host) => !!host.actions.openDiagram,
        run: (host) => host.actions.openDiagram?.(item.path),
      });
      commands.push({
        id: `info:${item.path}`,
        title: `Edit diagram info for ${label}`,
        keywords: ["title", "tags", "notes", ...keywords],
        section: "Diagram",
        searchOnly: true,
        run: (host) => host.navigate(`/edit/${item.path}?info=1`),
      });
    }
    commands.push(
      {
        id: `rename:${item.path}`,
        title: `Rename ${label}`,
        keywords,
        section: "Organize",
        searchOnly: true,
        when: (host) => !!host.actions.renameItem,
        run: (host) => host.actions.renameItem?.(item.path, item.type === "folder"),
      },
      {
        id: `move:${item.path}`,
        title: `Move ${label}`,
        keywords,
        section: "Organize",
        searchOnly: true,
        when: (host) => !!host.actions.moveItem,
        run: (host) => host.actions.moveItem?.(item.path, item.type === "folder"),
      },
      {
        id: `duplicate:${item.path}`,
        title: `Duplicate ${label}`,
        keywords,
        section: "Organize",
        searchOnly: true,
        when: (host) => !!host.actions.duplicateItem,
        run: (host) => host.actions.duplicateItem?.(item.path),
      },
      {
        id: `trash:${item.path}`,
        title: `Move ${label} to trash`,
        keywords: ["delete", ...keywords],
        section: "Organize",
        searchOnly: true,
        when: (host) => !!host.actions.trashItem,
        run: (host) => host.actions.trashItem?.(item.path),
      },
    );
  }
  for (const item of ctx.trashItems) {
    commands.push({
      id: `restore:${item.id}`,
      title: `Restore ${item.name}`,
      keywords: ["trash", item.type, item.name],
      section: "Trash",
      searchOnly: true,
      when: (host) => !!host.actions.restoreTrash,
      run: (host) => host.actions.restoreTrash?.(item.id),
    });
  }
  return commands;
});
