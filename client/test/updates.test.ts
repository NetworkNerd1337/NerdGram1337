import { describe, expect, it } from "vitest";
import "../src/lib/updateCommands";
import { collectCommands, EMPTY_COMMAND_HOST, type CommandContext } from "../src/lib/commands";
import { safeReleaseHref } from "../src/lib/releaseMarkdown";
import { reloadWarning } from "../src/lib/updateReload";

function context(): CommandContext {
  return { ...EMPTY_COMMAND_HOST, query: "", navigate: () => undefined, route: "dashboard" };
}

describe("update commands", () => {
  it("registers About and Check for updates without a shortcut", () => {
    const commands = collectCommands(context());
    const about = commands.find((command) => command.id === "app.about");
    const check = commands.find((command) => command.id === "app.checkUpdates");
    expect(about?.title).toBe("About NerdGram1337");
    expect(check?.title).toBe("Check for updates");
    expect(about?.shortcut).toBeUndefined();
    expect(check?.shortcut).toBeUndefined();
  });
});

describe("release links", () => {
  it("keeps http(s) and drops other schemes", () => {
    expect(safeReleaseHref("https://github.com/NetworkNerd1337/NerdGram1337/releases/tag/v1.2.0")).toMatch(/^https:/);
    expect(safeReleaseHref("javascript:alert(1)")).toBeNull();
    expect(safeReleaseHref("data:text/html,hi")).toBeNull();
    expect(safeReleaseHref("vbscript:msg")).toBeNull();
  });
});

describe("reload warning", () => {
  it("warns for presentation and unsaved edits", () => {
    expect(reloadWarning({ presenting: false, unsaved: false })).toBeNull();
    expect(reloadWarning({ presenting: true, unsaved: false })).toMatch(/presentation/i);
    expect(reloadWarning({ presenting: false, unsaved: true })).toMatch(/unsaved/i);
    expect(reloadWarning({ presenting: true, unsaved: true })).toMatch(/Reload now/);
  });
});
