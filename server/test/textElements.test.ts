import { describe, expect, it } from "vitest";
import { extractTextElements } from "../src/textElements.js";

const network = `flowchart LR
  Internet --> Firewall
  Firewall --> Core
  Core --> Access
`;

const welcome = `flowchart LR
  subgraph NerdGram1337
    Paste[Paste Mermaid] --> Render[Live Preview]
    Render --> Export[Export SVG PNG JPG]
  end
  Disk[(Local diagrams folder)] <--> Paste
`;

const sequence = `sequenceDiagram
  participant User
  participant NerdGram1337
  participant Mermaid.js
  participant Disk

  User->>NerdGram1337: Paste Mermaid markdown
  NerdGram1337->>Mermaid.js: Render diagram
  Mermaid.js-->>NerdGram1337: SVG preview
  User->>NerdGram1337: Save / Export
  NerdGram1337->>Disk: Write .mmd / download image
`;

function texts(source: string, kind?: string): string[] {
  return extractTextElements(source)
    .filter((item) => (kind ? item.kind === kind : true))
    .map((item) => item.text);
}

describe("diagram text extraction", () => {
  it("indexes visible node labels and bare ids, not the diagram keyword", () => {
    const elements = extractTextElements(network);
    expect(texts(network, "node")).toEqual(
      expect.arrayContaining(["Internet", "Firewall", "Core", "Access"]),
    );
    expect(elements.some((item) => item.text.toLowerCase() === "flowchart")).toBe(false);
    expect(elements.some((item) => item.text === "LR")).toBe(false);
    const firewall = elements.find((item) => item.text === "Firewall");
    expect(firewall).toMatchObject({ kind: "node", line: 2 });
  });

  it("indexes shaped labels, subgraph titles, and edge text, and skips a hidden id", () => {
    expect(texts(welcome, "node")).toEqual(
      expect.arrayContaining(["Paste Mermaid", "Live Preview", "Export SVG PNG JPG", "Local diagrams folder"]),
    );
    expect(texts(welcome, "subgraph")).toContain("NerdGram1337");
    expect(texts(welcome)).not.toContain("Paste");
    expect(texts(welcome)).not.toContain("Disk");
    expect(texts(welcome).some((text) => text.toLowerCase() === "flowchart")).toBe(false);

    const https = extractTextElements("flowchart LR\n  Client -->|HTTPS| Edge\n");
    expect(https).toContainEqual(expect.objectContaining({ kind: "edge", text: "HTTPS", line: 2 }));

    const hidden = extractTextElements("flowchart TD\n  Qx[StartLabel] --> Zy[EndLabel]\n");
    expect(texts("flowchart TD\n  Qx[StartLabel] --> Zy[EndLabel]\n")).toEqual(
      expect.arrayContaining(["StartLabel", "EndLabel"]),
    );
    expect(hidden.map((item) => item.text)).not.toContain("Qx");
    expect(hidden.map((item) => item.text)).not.toContain("TD");
  });

  it("indexes sequence participants and messages, not the diagram type", () => {
    const elements = extractTextElements(sequence);
    expect(texts(sequence, "message")).toEqual(
      expect.arrayContaining(["Paste Mermaid markdown", "SVG preview"]),
    );
    expect(texts(sequence, "participant")).toEqual(
      expect.arrayContaining(["User", "NerdGram1337", "Mermaid.js", "Disk"]),
    );
    expect(elements.some((item) => item.text.toLowerCase() === "sequencediagram")).toBe(false);
  });

  it("skips comments and still reads a title under front matter", () => {
    const source = [
      "---",
      "title: Kept in front matter",
      "---",
      "flowchart LR",
      "  %% Firewall",
      "  A[PublicLabel]",
    ].join("\n");
    const elements = extractTextElements(source);
    expect(elements.map((item) => item.text)).not.toContain("Firewall");
    expect(elements).toContainEqual(expect.objectContaining({ kind: "node", text: "PublicLabel", line: 6 }));
    expect(elements.some((item) => item.text === "Kept in front matter")).toBe(false);
  });

  it("reads class, ER, gantt, pie, and state text", () => {
    const er = extractTextElements(
      ["erDiagram", "CUSTOMER ||--o{ ORDER : places", "CUSTOMER {", "  string name", "}"].join("\n"),
    );
    expect(er.map((item) => item.text)).toEqual(expect.arrayContaining(["CUSTOMER", "ORDER", "places", "name"]));

    const gantt = extractTextElements(
      ["gantt", "title Launch", "section Build", "Write docs :a1, 2024-01-01, 2d"].join("\n"),
    );
    expect(gantt.map((item) => item.text)).toEqual(expect.arrayContaining(["Launch", "Build", "Write docs"]));

    const pie = extractTextElements(['pie title Pets', '  "Dogs" : 10'].join("\n"));
    expect(pie.map((item) => item.text)).toEqual(expect.arrayContaining(["Pets", "Dogs"]));

    const state = extractTextElements(
      ['stateDiagram-v2', '  [*] --> Active', '  Active --> Done: Ship it', '  note right of Active: Hold'].join("\n"),
    );
    expect(state.map((item) => item.text)).toEqual(expect.arrayContaining(["Active", "Done", "Ship it", "Hold"]));
    expect(state.some((item) => item.text.toLowerCase().includes("statediagram"))).toBe(false);
  });
});
