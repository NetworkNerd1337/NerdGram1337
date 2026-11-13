import { afterEach, describe, expect, it } from "vitest";
import {
  collectCommands,
  EMPTY_COMMAND_HOST,
  RESERVED_SHORTCUTS,
  type CommandContext,
} from "../src/lib/commands";
import { syncTemplateCommands, templatePaletteCommands } from "../src/lib/templateCommands";

const sample = [
  {
    id: "network-topology",
    title: "Network topology",
    description: "A campus access path",
    category: "Network",
    diagramType: "Flowchart",
    tags: ["vlan"],
  },
  {
    id: "home-lab",
    title: "Home lab",
    description: "Hypervisor",
    category: "Lab",
    diagramType: "Architecture",
    tags: ["nas"],
  },
];

function context(navigate: (to: string) => void = () => undefined): CommandContext {
  return {
    ...EMPTY_COMMAND_HOST,
    query: "",
    navigate,
    route: "dashboard",
  };
}

describe("template palette commands", () => {
  afterEach(() => {
    syncTemplateCommands([]);
  });

  it("registers the gallery and one new-from-template command per template", () => {
    const commands = templatePaletteCommands(sample);
    expect(commands.map((command) => command.title)).toEqual([
      "Open template gallery",
      "New from template: Network topology",
      "New from template: Home lab",
    ]);
    for (const command of commands) {
      expect(command.shortcut).toBeUndefined();
      expect(RESERVED_SHORTCUTS).not.toContain(command.shortcut);
    }

    syncTemplateCommands(sample);
    const titles = collectCommands(context()).map((command) => command.title);
    expect(titles).toContain("Open template gallery");
    expect(titles).toContain("New from template: Network topology");
    expect(titles).toContain("New from template: Home lab");

    const seen: string[] = [];
    const host = context((to) => seen.push(to));
    const use = collectCommands(host).find((command) => command.id === "template.use.network-topology");
    const open = collectCommands(host).find((command) => command.id === "file.templates");
    use?.run(host);
    open?.run(host);
    expect(seen).toEqual(["/templates?use=network-topology", "/templates"]);
  });

  it("replaces the previous template commands when the list changes", () => {
    syncTemplateCommands(sample);
    syncTemplateCommands(sample.slice(1));
    const titles = collectCommands(context()).map((command) => command.title);
    expect(titles).toContain("Open template gallery");
    expect(titles).toContain("New from template: Home lab");
    expect(titles).not.toContain("New from template: Network topology");
  });

  it("finds a template command from its name without a shortcut", () => {
    syncTemplateCommands(sample);
    const titles = collectCommands({ ...context(), query: "vlan" }).map((command) => command.title);
    expect(titles).toContain("New from template: Network topology");
  });
});
