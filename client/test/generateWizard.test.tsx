/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GenerateWizard } from "../src/components/GenerateWizard";
import {
  canCreate,
  diagramFilePath,
  initialWizardState,
  previewRequest,
  wizardReducer,
  type WizardInspection,
  type WizardState,
} from "../src/lib/generateWizard";
import { importDiagramData } from "../../server/src/diagramData.ts";
import { renderMermaid } from "../src/lib/mermaidRender";

const csv = `Local Device,Local Port,Remote Device,Remote Port,Local Group,Remote Diagram
Core,Gi0/0,Atlanta,Gi0/1,HQ,Sites/Atlanta.mmd
Core,Gi0/1,Remote,Gi0/0,HQ,
`;

function inspection(state: WizardState, _step: "map" | "preview"): WizardInspection {
  const request = previewRequest(state);
  const result = importDiagramData(request);
  return {
    format: result.format,
    shape: result.shape,
    headers: result.headers,
    edgesHeaders: result.edgesHeaders,
    mapping: result.mapping,
    edgesMapping: result.edgesMapping,
    errors: result.errors,
    warnings: result.warnings,
    mermaid: result.mermaid,
    counts: result.counts,
    direction: result.direction,
    grouping: result.grouping,
  };
}

describe("generate wizard flow", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("walks paste, column mapping, direction, preview, and create", () => {
    let state = initialWizardState("Sites");
    const seen: string[] = [];
    const dispatch = (action: Parameters<typeof wizardReducer>[1]) => {
      state = wizardReducer(state, action);
    };

    function render() {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(
          <GenerateWizard
            state={state}
            dispatch={dispatch}
            busy={false}
            onInspect={(step) => {
              seen.push(step);
              dispatch({ type: "result", result: inspection(state, step), step });
            }}
            onCreate={() => {
              seen.push(`create:${diagramFilePath(state)}`);
            }}
          />,
        );
      });
    }

    render();
    const data = document.querySelector<HTMLTextAreaElement>("#generate-data");
    expect(data).toBeTruthy();
    setValue(data!, csv);
    render();
    expect(state.text).toContain("Atlanta");
    (document.querySelector("button.btn-primary") as HTMLButtonElement).click();
    render();
    expect(seen).toEqual(["map"]);
    expect(state.step).toBe("map");
    expect(document.querySelector("#map-localDevice")).toBeTruthy();
    expect((document.querySelector("#map-localDevice") as HTMLSelectElement).value).toBe("Local Device");
    expect((document.querySelector("#map-remoteDiagram") as HTMLSelectElement).value).toBe("Remote Diagram");

    const direction = document.querySelector<HTMLSelectElement>("#generate-direction");
    setValue(direction!, "TD");
    render();
    expect(state.direction).toBe("TD");
    const previewButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Preview");
    previewButton?.click();
    render();
    expect(state.step).toBe("preview");
    expect(state.errors).toEqual([]);
    expect(state.mermaid).toContain("flowchart TD");
    expect(state.mermaid).toContain("subgraph");
    expect(state.mermaid).toContain('click Atlanta "nerdgram:Sites/Atlanta.mmd"');
    expect(canCreate(state)).toBe(true);

    const name = document.querySelector<HTMLInputElement>("#generate-name");
    setValue(name!, "Campus");
    render();
    expect(diagramFilePath(state)).toBe("Sites/Campus.mmd");
    (document.querySelector("button.btn-primary") as HTMLButtonElement).click();
    expect(seen.at(-1)).toBe("create:Sites/Campus.mmd");
    expect(previewRequest(state).direction).toBe("TD");
    expect(previewRequest(state).grouping).toBe(true);
  });

  it.each([
    ["cdp", "Cisco CDP", "core-sw#show cdp neighbors detail\n-------------------------\nDevice ID: dist-sw\nPlatform: cisco C9300-48P, Capabilities: Switch\nInterface: Gi1/0/1, Port ID (outgoing port): Gi1/0/48\n"],
    ["lldp", "LLDP neighbors", "core-sw#show lldp neighbors detail\nLocal Intf: Gi1/0/1\nPort id: Gi1/0/48\nSystem Name: dist-sw\nSystem Description: Cisco IOS Software\nEnabled Capabilities: B\n"],
  ] as const)("chooses %s in the wizard and previews a diagram", (format, label, sample) => {
    let state = initialWizardState("Sites");
    const dispatch = (action: Parameters<typeof wizardReducer>[1]) => {
      state = wizardReducer(state, action);
    };
    function render() {
      act(() => {
        if (!root) {
          const host = document.createElement("div");
          document.body.appendChild(host);
          root = createRoot(host);
        }
        root?.render(
          <GenerateWizard
            state={state}
            dispatch={dispatch}
            busy={false}
            onInspect={(step) => dispatch({ type: "result", result: inspection(state, step), step })}
            onCreate={() => undefined}
          />,
        );
      });
    }

    render();
    setValue(document.querySelector<HTMLSelectElement>("#generate-format")!, format);
    render();
    expect(document.querySelector("label[for='generate-data']")?.textContent).toContain(label === "Cisco CDP" ? "Cisco CDP" : "LLDP");
    expect(document.querySelector("#generate-edges")).toBeNull();
    expect(document.querySelector("#generate-local-device")).toBeTruthy();
    setValue(document.querySelector<HTMLTextAreaElement>("#generate-data")!, sample);
    render();
    (document.querySelector("button.btn-primary") as HTMLButtonElement).click();
    render();
    expect(state.step).toBe("map");
    expect(document.querySelector("#map-localDevice")).toBeNull();
    expect(document.querySelector("#generate-group-by")).toBeTruthy();
    setValue(document.querySelector<HTMLSelectElement>("#generate-group-by")!, "capability");
    render();
    const previewButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Preview");
    previewButton?.click();
    render();
    expect(state.step).toBe("preview");
    expect(state.errors).toEqual([]);
    expect(state.mermaid).toContain("flowchart LR");
    expect(state.mermaid).toContain('["dist-sw"]');
    expect(state.mermaid).toContain('["Switch"]');
    expect(canCreate(state)).toBe(true);
    expect(previewRequest(state).format).toBe(format);
    expect(previewRequest(state).groupBy).toBe("capability");
    expect(previewRequest(state).sourceFile).toBe(format === "cdp" ? "Sites/Untitled.cdp" : "Sites/Untitled.lldp");
  });

  it("keeps create disabled when a row is invalid", () => {
    let state = wizardReducer(initialWizardState(), { type: "text", text: "Local Device,Remote Device\nCore,\n" });
    const result = inspection(state, "preview");
    state = wizardReducer(state, { type: "result", result, step: "preview" });
    expect(state.errors.some((issue) => issue.message.includes("Row 2"))).toBe(true);
    expect(canCreate(state)).toBe(false);
  });

  it(
    "renders a generated diagram, including a label that tries to inject a directive",
    async () => {
      installTextBox();
      const clean = importDiagramData({ text: csv, direction: "LR", sourceFile: "campus.csv" });
      const drawn = await renderMermaid(clean.mermaid);
      expect(drawn.svg).toContain("<svg");
      expect(drawn.svg.toLowerCase()).not.toContain("syntax error");

      const nasty = '"]\nclick pwn "javascript:alert(1)"\n';
      const attacked = importDiagramData({
        text: `id,label\ncore,"${nasty.replaceAll('"', '""')}"\nedge,Edge\n`,
        edgesText: "source,target\ncore,edge\n",
        shape: "graph",
      });
      expect(attacked.errors).toEqual([]);
      const attackedSvg = await renderMermaid(attacked.mermaid);
      expect(attackedSvg.svg.toLowerCase()).not.toContain("syntax error");
      expect(attackedSvg.svg.toLowerCase()).not.toContain("javascript:");
    },
    30_000,
  );
});

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = Object.getPrototypeOf(element) as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function installTextBox(): void {
  const box = function (this: Element) {
    const text = this.textContent ?? "";
    return new DOMRect(0, 0, Math.max(8, text.trim().length * 7), text.trim() ? 18 : 8);
  };
  for (const ctor of [globalThis.SVGElement, globalThis.SVGGraphicsElement]) {
    Object.defineProperty(ctor.prototype, "getBBox", { configurable: true, value: box });
  }
}
