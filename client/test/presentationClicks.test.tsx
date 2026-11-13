/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationView } from "../src/components/PresentationView";

const readFile = vi.hoisted(() => vi.fn());

vi.mock("../src/api", () => ({
  api: {
    tree: async () => ({
      tree: [
        { path: "WAN.mmd", type: "file", name: "WAN.mmd" },
        { path: "Sites/Atlanta.mmd", type: "file", name: "Atlanta.mmd" },
      ],
    }),
    readFile,
  },
}));

vi.mock("../src/lib/mermaidRender", () => ({
  renderMermaid: async () => ({
    id: "mock",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><g class="node" id="flowchart-Atlanta-1"><text>Atlanta</text></g></svg>`,
  }),
}));

const SOURCE = `flowchart LR
  Core[Core] --> Atlanta[Atlanta]
  click Atlanta "nerdgram:Sites/Atlanta.mmd" "Open Atlanta"
`;

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    clientX: x,
    clientY: y,
  });
}

describe("presentation drill-down", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    readFile.mockReset();
  });

  async function mount(): Promise<SVGGElement> {
    readFile.mockImplementation(async (path: string) => ({
      path,
      content: "flowchart LR\n  Site[Atlanta site]\n",
      hash: "h",
      mtimeMs: 1,
    }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<PresentationView source={SOURCE} path="WAN.mmd" onExit={() => undefined} />);
    });
    const node = document.querySelector(".presentation-canvas g.node");
    expect(node).toBeTruthy();
    return node as SVGGElement;
  }

  it("drills down from a real pointer down and up on a linked node", async () => {
    const node = await mount();
    await act(async () => {
      node.dispatchEvent(pointer("pointerdown", 20, 20));
      node.dispatchEvent(pointer("pointerup", 20, 20));
    });
    expect(readFile).toHaveBeenCalledWith("Sites/Atlanta.mmd");
  });

  it("pans instead of drilling when the pointer moves", async () => {
    const node = await mount();
    await act(async () => {
      node.dispatchEvent(pointer("pointerdown", 20, 20));
      node.dispatchEvent(pointer("pointermove", 80, 20));
      node.dispatchEvent(pointer("pointerup", 80, 20));
    });
    expect(readFile).not.toHaveBeenCalled();
  });
});
