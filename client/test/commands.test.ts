import { afterEach, describe, expect, it } from "vitest";
import "../src/lib/builtinCommands";
import {
  collectCommands,
  EMPTY_COMMAND_HOST,
  filterCommands,
  formatShortcut,
  isPaletteShortcut,
  registerCommandProvider,
  registerCommands,
  RESERVED_SHORTCUTS,
  scoreCommand,
  type CommandContext,
  type PaletteCommand,
} from "../src/lib/commands";

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    ...EMPTY_COMMAND_HOST,
    query: "",
    navigate: () => undefined,
    route: "dashboard",
    actions: {
      newDiagram: () => undefined,
      newFolder: () => undefined,
      focusSearch: () => undefined,
      importFiles: () => undefined,
      openTrash: () => undefined,
      emptyTrash: () => undefined,
      openDiagram: () => undefined,
      openFolder: () => undefined,
      renameItem: () => undefined,
      moveItem: () => undefined,
      duplicateItem: () => undefined,
      trashItem: () => undefined,
      restoreTrash: () => undefined,
    },
    items: [
      { path: "Welcome.mmd", name: "Welcome.mmd", type: "file", title: "Hello" },
      { path: "Lab", name: "Lab", type: "folder", title: null },
    ],
    trashItems: [{ id: "t1", name: "Old.mmd", type: "file" }],
    ...overrides,
  };
}

const extra: PaletteCommand = {
  id: "test.extra",
  title: "Check for updates",
  keywords: ["upgrade"],
  order: 1,
  run: () => undefined,
};

describe("command palette registry", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("lists the actions that exist and hides editor commands on the dashboard", () => {
    const titles = collectCommands(context()).map((command) => command.title);
    expect(titles).toContain("New diagram");
    expect(titles).toContain("Paste Mermaid");
    expect(titles).toContain("New folder");
    expect(titles).toContain("Import diagrams");
    expect(titles).toContain("Search diagrams");
    expect(titles).toContain("Open trash");
    expect(titles).not.toContain("Find");
    expect(titles).not.toContain("Export as SVG");
    expect(titles).not.toContain("Open Hello");
    expect(titles).not.toContain("Open folder Lab");
  });

  it("filters diagrams and organize actions by a fuzzy query", () => {
    const titles = collectCommands(context({ query: "welcome" })).map((command) => command.title);
    expect(titles).toContain("Open Hello");
    expect(titles).toContain("Rename Hello");
    expect(titles).toContain("Move Hello");
    expect(titles).toContain("Duplicate Hello");
    expect(titles).toContain("Move Hello to trash");
    expect(titles).toContain("Edit diagram info for Hello");
    expect(titles).not.toContain("Open folder Lab");
  });

  it("shows find, export, and theme commands only when the editor can run them", () => {
    const editor = context({
      route: "editor",
      query: "",
      hasPreview: true,
      actions: {
        find: () => undefined,
        replace: () => undefined,
        gotoLine: () => undefined,
        exportAs: () => undefined,
        setTheme: () => undefined,
        editDiagramInfo: () => undefined,
        openHistory: () => undefined,
        toggleAutoUpdate: () => undefined,
      },
    });
    const idle = collectCommands(editor).map((command) => command.id);
    expect(idle).toContain("editor.find");
    expect(idle).toContain("editor.replace");
    expect(idle).toContain("editor.gotoLine");
    expect(idle).toContain("editor.export.svg");
    expect(idle).toContain("editor.export.pdf");
    expect(idle).not.toContain("editor.export.svg".replace("svg", "gif"));
    expect(idle).not.toContain("editor.theme.forest");

    const themed = collectCommands({ ...editor, query: "forest" }).map((command) => command.id);
    expect(themed).toContain("editor.theme.forest");

    const blocked = collectCommands({ ...editor, conflictOpen: true }).map((command) => command.id);
    expect(blocked).not.toContain("editor.export.svg");
    expect(blocked).toContain("editor.find");
  });

  it("registers and unregisters commands other features can add", () => {
    const seen: string[] = [];
    const command: PaletteCommand = {
      ...extra,
      run: () => {
        seen.push("ran");
      },
    };
    const remove = registerCommands([command]);
    cleanups.push(remove);
    const found = collectCommands(context({ query: "updates" }));
    expect(found.some((item) => item.id === "test.extra")).toBe(true);
    void found.find((item) => item.id === "test.extra")?.run(context());
    expect(seen).toEqual(["ran"]);
    remove();
    expect(collectCommands(context({ query: "updates" })).some((item) => item.id === "test.extra")).toBe(
      false,
    );
  });

  it("lets a provider add commands and remove them again", () => {
    const remove = registerCommandProvider(() => [
      {
        id: "present.start",
        title: "Present diagram",
        searchOnly: true,
        run: () => undefined,
      },
    ]);
    cleanups.push(remove);
    expect(collectCommands(context()).some((command) => command.id === "present.start")).toBe(false);
    expect(
      collectCommands(context({ query: "present" })).some((command) => command.id === "present.start"),
    ).toBe(true);
    remove();
    expect(
      collectCommands(context({ query: "present" })).some((command) => command.id === "present.start"),
    ).toBe(false);
  });

  it("does not assign reserved shortcuts to built-in commands", () => {
    const reserved = new Set<string>(RESERVED_SHORTCUTS);
    const commands = collectCommands(
      context({
        route: "editor",
        query: "a",
        hasPreview: true,
        readOnly: false,
        actions: {
          find: () => undefined,
          replace: () => undefined,
          gotoLine: () => undefined,
          exportAs: () => undefined,
          setTheme: () => undefined,
        },
      }),
    );
    for (const command of commands) {
      if (!command.shortcut) continue;
      expect(reserved.has(command.shortcut)).toBe(false);
    }
    expect(formatShortcut("Mod-Alt-g", false)).toBe("Ctrl+Alt+G");
    expect(formatShortcut("Mod-k", true)).toBe("⌘K");
    expect(scoreCommand({ id: "x", title: "Rename", run: () => undefined }, "zzz")).toBeNull();
    expect(
      filterCommands(
        [
          { id: "a", title: "Alpha", searchOnly: true, run: () => undefined },
          { id: "b", title: "Beta", order: 1, run: () => undefined },
        ],
        "",
      ).map((command) => command.id),
    ).toEqual(["b"]);
  });

  it("treats Ctrl+K and Cmd+K as the palette shortcut and ignores shifted variants", () => {
    expect(
      isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }),
    ).toBe(true);
    expect(
      isPaletteShortcut({ key: "K", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }),
    ).toBe(true);
    expect(
      isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }),
    ).toBe(false);
    expect(
      isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false }),
    ).toBe(false);
    expect(
      isPaletteShortcut({
        key: "k",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: true,
      }),
    ).toBe(false);
    expect(
      isPaletteShortcut({ key: "l", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }),
    ).toBe(false);
  });
});
