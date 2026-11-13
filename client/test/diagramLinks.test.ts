import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DrillTrail } from "../src/components/DrillTrail";
import { actionForClickTarget, clickTargetOnElement } from "../src/lib/diagramClicks";
import { clickTargetFromNode } from "../../server/src/diagramLinks.ts";
import { clickPathCompletions } from "../src/lib/mermaidCompletions";
import { insertDiagramLink } from "../../server/src/diagramLinks.ts";
import { drillForward, drillIndex, singleTrail } from "../src/lib/drillTrail";
import { sessionJump, sessionOpen, sessionStart } from "../src/lib/drillSession";

const known = ["WAN.mmd", "Sites/Atlanta.mmd", "Sites/Atlanta-Rack.mmd"];

describe("click navigation", () => {
  it("navigates nerdgram and relative diagrams, and blocks unsafe urls", () => {
    expect(actionForClickTarget('nerdgram:Sites/Atlanta.mmd', "WAN.mmd", known)).toEqual({
      type: "navigate",
      path: "Sites/Atlanta.mmd",
    });
    expect(actionForClickTarget("./Atlanta-Rack.mmd", "Sites/Atlanta.mmd", known)).toEqual({
      type: "navigate",
      path: "Sites/Atlanta-Rack.mmd",
    });
    expect(actionForClickTarget("https://example.com/a", "WAN.mmd", known)).toMatchObject({
      type: "external",
      url: "https://example.com/a",
    });
    const blocked = actionForClickTarget("javascript:alert(1)", "WAN.mmd", known);
    expect(blocked.type).toBe("broken");
    if (blocked.type === "broken") expect(blocked.message).toMatch(/blocked/i);
    const missing = actionForClickTarget("nerdgram:Missing.mmd", "WAN.mmd", known);
    expect(missing.type).toBe("broken");
    if (missing.type === "broken") expect(missing.message).toMatch(/No diagram at Missing.mmd/);
  });

  it("reads the click target from the rendered node id", () => {
    const source = 'flowchart LR\n  Atlanta[Atlanta]\n  click Atlanta "nerdgram:Sites/Atlanta.mmd"\n';
    const node = {
      id: "text",
      dataId: null,
      href: null,
      tag: "span",
      parent: { id: "flowchart-Atlanta-1", dataId: null, href: null, tag: "g", parent: null },
    };
    expect(clickTargetFromNode(source, node)).toBe("nerdgram:Sites/Atlanta.mmd");
    expect(clickTargetOnElement(source, null)).toBeNull();
  });
});

describe("breadcrumbs and presentation drill-down", () => {
  it("keeps the path taken and walks back and forward", () => {
    const start = singleTrail({ path: "WAN.mmd", title: "WAN" });
    const atlanta = drillForward(start, { path: "Sites/Atlanta.mmd", title: "Atlanta" });
    const rack = drillForward(atlanta, { path: "Sites/Atlanta-Rack.mmd", title: "Rack 3" });
    expect(rack.crumbs.map((crumb) => crumb.title)).toEqual(["WAN", "Atlanta", "Rack 3"]);
    const back = drillIndex(rack, 1);
    expect(back.crumbs[back.index]?.title).toBe("Atlanta");
    const forward = drillIndex(back, 2);
    expect(forward.crumbs[forward.index]?.title).toBe("Rack 3");
    const branched = drillForward(back, { path: "Sites/Other.mmd", title: "Other" });
    expect(branched.crumbs.map((crumb) => crumb.title)).toEqual(["WAN", "Atlanta", "Other"]);
  });

  it("renders the trail with back and forward", () => {
    const trail = drillForward(
      drillForward(singleTrail({ path: "WAN.mmd", title: "WAN" }), { path: "Sites/Atlanta.mmd", title: "Atlanta" }),
      { path: "Sites/Rack.mmd", title: "Rack 3" },
    );
    const html = renderToStaticMarkup(
      createElement(DrillTrail, {
        trail,
        onBack: () => undefined,
        onForward: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain("WAN");
    expect(html).toContain("Atlanta");
    expect(html).toContain("Rack 3");
    expect(html).toContain("Back");
    expect(html).toContain("Forward");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(">Atlanta<");
  });

  it("drills down and back inside a presentation session", () => {
    const start = sessionStart({ path: "WAN.mmd", title: "WAN", source: "flowchart LR\n  A[WAN]\n", error: null });
    const drilled = sessionOpen(start, {
      path: "Sites/Atlanta.mmd",
      title: "Atlanta",
      source: "flowchart TB\n  Edge[Edge]\n",
      error: null,
    });
    expect(drilled.index).toBe(1);
    expect(drilled.slides[0]?.path).toBe("WAN.mmd");
    const back = sessionJump(drilled, 0);
    expect(back.slides[back.index]?.title).toBe("WAN");
    expect(back.slides).toHaveLength(2);
    const forward = sessionJump(back, 1);
    expect(forward.slides[forward.index]?.title).toBe("Atlanta");
  });
});

describe("authoring a click link", () => {
  it("inserts a nerdgram click line and offers diagram paths", () => {
    const next = insertDiagramLink("flowchart LR\n  Atlanta[Atlanta]\n", "Atlanta", "Sites/Atlanta.mmd", "Open Atlanta");
    expect(next).toContain('click Atlanta "nerdgram:Sites/Atlanta.mmd" "Open Atlanta"');
    const replaced = insertDiagramLink(next, "Atlanta", "Sites/Rack.mmd", "Open Rack 3");
    expect(replaced).toContain('click Atlanta "nerdgram:Sites/Rack.mmd" "Open Rack 3"');
    expect(replaced).not.toContain("Sites/Atlanta.mmd");

    const line = '  click Atlanta "nerd';
    const completions = clickPathCompletions(line, line.length, known, "WAN.mmd");
    expect(completions?.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(["nerdgram:Sites/Atlanta.mmd", "Sites/Atlanta.mmd"]),
    );
  });
});
