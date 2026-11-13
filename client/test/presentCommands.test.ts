import { afterEach, describe, expect, it } from "vitest";
import {
  collectCommands,
  EMPTY_COMMAND_HOST,
  RESERVED_SHORTCUTS,
  type CommandContext,
} from "../src/lib/commands";
import {
  PRESENT_COMMAND_ID,
  presentCommand,
  registerPresentCommand,
  removePresentCommand,
} from "../src/lib/presentCommands";

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    ...EMPTY_COMMAND_HOST,
    query: "",
    navigate: () => undefined,
    route: "editor",
    actions: { present: () => undefined },
    ...overrides,
  };
}

describe("Present command", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    if (!collectCommands(context()).some((command) => command.id === PRESENT_COMMAND_ID)) {
      cleanups.push(registerPresentCommand());
    }
  });

  it("registers Present for the open editor and removes it again", () => {
    const ran: string[] = [];
    const host = context({
      actions: {
        present: () => {
          ran.push("present");
        },
      },
    });
    const found = collectCommands(host).find((command) => command.id === PRESENT_COMMAND_ID);
    expect(found?.title).toBe("Present diagram");
    expect(found?.shortcut).toBe("F5");
    expect(RESERVED_SHORTCUTS).toContain("F5");
    expect(RESERVED_SHORTCUTS).toContain("Mod-Shift-Enter");
    found?.run(host);
    expect(ran).toEqual(["present"]);

    removePresentCommand();
    expect(collectCommands(host).some((command) => command.id === PRESENT_COMMAND_ID)).toBe(false);
    const restore = registerPresentCommand();
    cleanups.push(restore);
    expect(collectCommands(host).some((command) => command.id === PRESENT_COMMAND_ID)).toBe(true);
    expect(presentCommand.id).toBe(PRESENT_COMMAND_ID);
  });

  it("hides Present on the dashboard and while a conflict dialog is open", () => {
    const dashboard = collectCommands(context({ route: "dashboard" })).map((command) => command.id);
    expect(dashboard).not.toContain(PRESENT_COMMAND_ID);
    const blocked = collectCommands(context({ conflictOpen: true })).map((command) => command.id);
    expect(blocked).not.toContain(PRESENT_COMMAND_ID);
    const readonly = collectCommands(context({ readOnly: true })).map((command) => command.id);
    expect(readonly).toContain(PRESENT_COMMAND_ID);
  });
});
