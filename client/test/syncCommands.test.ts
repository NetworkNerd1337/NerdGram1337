import { describe, expect, it } from "vitest";
import "../src/lib/syncCommands";
import { collectCommands, EMPTY_COMMAND_HOST, RESERVED_SHORTCUTS, type CommandContext } from "../src/lib/commands";

function context(): CommandContext {
  return {
    ...EMPTY_COMMAND_HOST,
    query: "",
    navigate: () => undefined,
    route: "dashboard",
  };
}

describe("GitHub sync commands", () => {
  it("registers Sync now and status without a shortcut", () => {
    const commands = collectCommands(context());
    const syncNow = commands.find((command) => command.id === "sync.now");
    const status = commands.find((command) => command.id === "sync.status");
    expect(syncNow?.title).toBe("Sync now");
    expect(status?.title).toBe("GitHub sync status");
    expect(syncNow?.shortcut).toBeUndefined();
    expect(status?.shortcut).toBeUndefined();
    expect(RESERVED_SHORTCUTS).not.toContain(syncNow?.shortcut);
  });
});
