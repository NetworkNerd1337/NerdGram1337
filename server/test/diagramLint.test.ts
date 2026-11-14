import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyEdits,
  lintDiagram,
  mergeAstFacts,
  normalizeLintRules,
  type LintDiagnostic,
  type LintFix,
} from "../src/diagramLint.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function byRule(source: string, ruleId: string, options?: Parameters<typeof lintDiagram>[1]): LintDiagnostic[] {
  return lintDiagram(source, options).filter((item) => item.ruleId === ruleId);
}

function fixNamed(diagnostic: LintDiagnostic, id: LintFix["id"]): LintFix {
  const fix = diagnostic.fixes.find((item) => item.id === id);
  expect(fix, `${id} on ${diagnostic.message}`).toBeTruthy();
  if (!fix) throw new Error("missing fix");
  return fix;
}

function restored(source: string, fix: LintFix): string {
  const next = applyEdits(source, fix.edits);
  const inverse = fix.edits.map((edit) => ({
    from: edit.from,
    to: edit.from + edit.insert.length,
    insert: source.slice(edit.from, edit.to),
  }));
  return applyEdits(next, inverse);
}

describe("duplicate node ids", () => {
  it("warns when the same id is defined with two labels and can rename or jump", () => {
    const source = "flowchart LR\n  A[One] --> B[End]\n  A[Two]\n";
    const hits = byRule(source, "duplicate-id");
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit?.line).toBe(3);
    expect(hit?.message).toContain("Two");
    expect(hit?.message).toContain("One");
    const rename = fixNamed(hit!, "rename-duplicate");
    expect(applyEdits(source, rename.edits)).toContain("A2[Two]");
    expect(applyEdits(source, rename.edits)).toContain("A[One]");
    expect(restored(source, rename)).toBe(source);
    const jump = fixNamed(hit!, "jump-to-definition");
    expect(jump.edits).toEqual([]);
    expect(source.slice(jump.jump?.from, jump.jump?.to)).toBe("A");
    expect(applyEdits(source, jump.edits)).toBe(source);
  });

  it("stays quiet when the same id repeats the same label", () => {
    const source = "flowchart LR\n  A[One] --> B[End]\n  A[One] --> C[More]\n";
    expect(byRule(source, "duplicate-id")).toEqual([]);
  });
});

describe("unconnected flowchart nodes", () => {
  it("warns about a node left out of the connections", () => {
    const source = "flowchart LR\n  A[Start] --> B[End]\n  C[Orphan]\n";
    const hits = byRule(source, "unconnected-node");
    expect(hits.map((hit) => hit.subject)).toEqual(["C"]);
    expect(hits[0]?.line).toBe(3);
  });

  it("does not warn when every node is connected, or when a single node has no edges", () => {
    expect(byRule("flowchart LR\n  A[Start] --> B[End]\n", "unconnected-node")).toEqual([]);
    expect(byRule("flowchart LR\n  A[Only]\n", "unconnected-node")).toEqual([]);
    expect(byRule("flowchart TD\n  Internet --> Firewall\n  Firewall --> Core\n", "unconnected-node")).toEqual([]);
  });
});

describe("edges to a node with no label", () => {
  it("warns when a connection names an id that was never labeled", () => {
    const source = "flowchart LR\n  Start[Start] --> Ennd\n";
    const hits = byRule(source, "unlabeled-endpoint");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("Ennd");
    expect(hits[0]?.message).toMatch(/no label/i);
  });

  it("does not warn for implicit ids, or when every endpoint has a label", () => {
    expect(byRule("flowchart LR\n  Internet --> Firewall\n", "unlabeled-endpoint")).toEqual([]);
    expect(byRule("flowchart LR\n  Start[Start] --> End[End]\n", "unlabeled-endpoint")).toEqual([]);
  });

  it("does not flag an implicit flowchart just because one extra node has a label", () => {
    const source = "flowchart LR\n  Internet --> Firewall\n  Firewall --> Core\n  C[Orphan]\n";
    expect(byRule(source, "unlabeled-endpoint")).toEqual([]);
    expect(byRule(source, "unconnected-node").map((hit) => hit.subject)).toEqual(["C"]);
  });

  it("warns on a sequence message to a participant that was never declared", () => {
    const source = "sequenceDiagram\n  participant Alice\n  Alice->>Alic: Hi\n";
    const hits = byRule(source, "unlabeled-endpoint");
    expect(hits.map((hit) => hit.subject)).toEqual(["Alic"]);
  });

  it("does not warn when sequence participants are only implicit", () => {
    const source = "sequenceDiagram\n  Alice->>Bob: Hi\n";
    expect(byRule(source, "unlabeled-endpoint")).toEqual([]);
  });

  it("does not treat the hyphens in a return arrow as part of a declared participant", () => {
    const source = "sequenceDiagram\n  participant Service\n  participant Store\n  Store-->>Service: Record\n  Service-->>Client: Response\n";
    expect(byRule(source, "unlabeled-endpoint").map((hit) => hit.subject)).toEqual(["Client"]);
  });

  it("warns on a state transition to an undeclared state, and not on a plain transition list", () => {
    const declared = "stateDiagram-v2\n  state \"Moving\" as Moving\n  Still --> Moving\n";
    expect(byRule(declared, "unlabeled-endpoint").map((hit) => hit.subject)).toEqual(["Still"]);
    const plain = "stateDiagram-v2\n  [*] --> Still\n  Still --> Moving\n";
    expect(byRule(plain, "unlabeled-endpoint")).toEqual([]);
  });
});

describe("classDef and class", () => {
  it("warns about an unused classDef and removes it", () => {
    const source = "flowchart LR\n  classDef muted fill:#eee\n  classDef used fill:#333\n  A[One]:::used --> B[Two]\n";
    const hits = byRule(source, "unused-class");
    expect(hits.map((hit) => hit.subject)).toEqual(["muted"]);
    const remove = fixNamed(hits[0]!, "remove-classdef");
    const next = applyEdits(source, remove.edits);
    expect(next).not.toContain("muted");
    expect(next).toContain("classDef used");
    expect(restored(source, remove)).toBe(source);
    expect(byRule(next, "unused-class")).toEqual([]);
  });

  it("does not warn when the class is applied, including the default class", () => {
    const source = "flowchart LR\n  classDef used fill:#333\n  classDef default fill:#fff\n  A[One]:::used --> B[Two]\n";
    expect(byRule(source, "unused-class")).toEqual([]);
    expect(byRule(source, "undefined-class")).toEqual([]);
  });

  it("warns about a class that was never defined and can create it", () => {
    const source = "flowchart LR\n  A[One] --> B[Two]\n  class A missing\n";
    const hits = byRule(source, "undefined-class");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("missing");
    const create = fixNamed(hits[0]!, "create-class");
    const next = applyEdits(source, create.edits);
    expect(next).toContain("classDef missing fill:#f9f,stroke:#333");
    expect(byRule(next, "undefined-class")).toEqual([]);
    expect(restored(source, create)).toBe(source);
  });

  it("warns about a ::: class with no classDef, on flowcharts and state diagrams", () => {
    expect(byRule("flowchart LR\n  A[One]:::missing --> B[Two]\n", "undefined-class")[0]?.subject).toBe("missing");
    const state = "stateDiagram-v2\n  [*] --> Still\n  classDef bad fill:#f00\n  class Still other\n";
    expect(byRule(state, "undefined-class").map((hit) => hit.subject)).toEqual(["other"]);
    expect(byRule(state, "unused-class").map((hit) => hit.subject)).toEqual(["bad"]);
  });
});

describe("front matter", () => {
  it("points at a YAML header that cannot be parsed", () => {
    const source = "---\ntitle: [\n---\nflowchart LR\n  A --> B\n";
    const hits = byRule(source, "front-matter");
    expect(hits.some((hit) => hit.severity === "error" && /YAML header/.test(hit.message))).toBe(true);
    expect(hits[0]?.line).toBeGreaterThan(0);
  });

  it("warns about an unknown theme and tags that are not a list", () => {
    const source = "---\ntitle: Map\nconfig:\n  theme: neon\nnerdgram:\n  tags: lab\n---\nflowchart LR\n  A[One] --> B[Two]\n";
    const hits = byRule(source, "front-matter");
    expect(hits.map((hit) => hit.message).join("\n")).toMatch(/neon/);
    expect(hits.map((hit) => hit.message).join("\n")).toMatch(/Tags/);
  });

  it("accepts a normal header", () => {
    const source = "---\ntitle: Map\nconfig:\n  theme: forest\n  look: classic\n  layout: dagre\nnerdgram:\n  tags:\n    - lab\n---\nflowchart LR\n  A[One] --> B[Two]\n";
    expect(byRule(source, "front-matter")).toEqual([]);
  });
});

describe("click links to diagrams", () => {
  const source = 'flowchart LR\n  A[One] --> B[Two]\n  click A "Missing.mmd" "Open"\n  click B "https://example.com"\n';

  it("warns when a diagram path is not in the workspace", () => {
    const hits = byRule(source, "broken-click", { diagramPaths: ["Welcome.mmd", "Examples/Sequence.mmd"] });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("Missing.mmd");
    expect(hits[0]?.message).toMatch(/does not match/);
    expect(hits[0]?.fixes.map((fix) => fix.id)).toEqual(["repair-links"]);
  });

  it("stays quiet for a known path, a web link, and when no workspace list was given", () => {
    expect(byRule(source, "broken-click", { diagramPaths: ["Missing.mmd"] })).toEqual([]);
    expect(byRule(source, "broken-click")).toEqual([]);
    const linked = 'flowchart LR\n  A[One] --> B[Two]\n  click A "./Examples/Sequence.mmd"\n';
    expect(byRule(linked, "broken-click", { diagramPaths: ["Examples/Sequence.mmd"] })).toEqual([]);
  });

  it("resolves nerdgram: and relative paths from the diagram that contains them", () => {
    const sourcePath = "Sites/WAN.mmd";
    const paths = ["WAN.mmd", "Sites/WAN.mmd", "Sites/Atlanta.mmd"];
    const linked =
      'flowchart LR\n  A[Atlanta] --> B[Overview]\n  click A "nerdgram:Sites/Atlanta.mmd"\n  click B "../WAN.mmd"\n';
    expect(byRule(linked, "broken-click", { diagramPaths: paths, sourcePath })).toEqual([]);
    const missing = 'flowchart LR\n  A[Atlanta]\n  click A "Missing.mmd"\n';
    const hits = byRule(missing, "broken-click", { diagramPaths: paths, sourcePath });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toMatch(/does not match/);
    const escape = 'flowchart LR\n  A[Atlanta]\n  click A "../../secret.mmd"\n';
    const escaped = byRule(escape, "broken-click", { diagramPaths: paths, sourcePath })[0];
    expect(escaped?.message).toMatch(/leaves the workspace/);
    expect(escaped?.fixes).toEqual([]);
  });
});

describe("rule switches and samples", () => {
  it("turns a rule off without hiding the others", () => {
    const source = "flowchart LR\n  A[One] --> Ennd\n  C[Orphan]\n";
    const hits = lintDiagram(source, { rules: { "unlabeled-endpoint": false } });
    expect(hits.some((hit) => hit.ruleId === "unlabeled-endpoint")).toBe(false);
    expect(hits.some((hit) => hit.ruleId === "unconnected-node")).toBe(true);
    expect(normalizeLintRules({ "duplicate-id": false, ignored: true, "unused-class": "no" })["unused-class"]).toBe(true);
    expect(normalizeLintRules({ "duplicate-id": false })["duplicate-id"]).toBe(false);
    expect(normalizeLintRules(undefined)["invalid-date"]).toBe(true);
    expect(normalizeLintRules({ "duplicate-class": false })["duplicate-class"]).toBe(false);
  });

  it("does not flag seeded diagrams or bundled templates", () => {
    const diagramRoot = path.join(repoRoot, "diagrams");
    const diagramFiles = collectMmd(diagramRoot);
    const diagramPaths = diagramFiles.map((file) => path.relative(diagramRoot, file).split(path.sep).join("/"));
    for (const file of diagramFiles) {
      const source = fs.readFileSync(file, "utf8");
      const sourcePath = path.relative(diagramRoot, file).split(path.sep).join("/");
      expect(lintDiagram(source, { diagramPaths, sourcePath }), sourcePath).toEqual([]);
    }
    for (const file of collectMmd(path.join(repoRoot, "templates"))) {
      const source = fs.readFileSync(file, "utf8");
      expect(lintDiagram(source, { diagramPaths: [] }), path.basename(file)).toEqual([]);
    }
  });

  it("checks a large flowchart without a noticeable delay", () => {
    const lines = ["flowchart LR"];
    for (let index = 0; index < 2000; index += 1) {
      lines.push(`  n${index}[Step ${index}] --> n${index + 1}[Step ${index + 1}]`);
    }
    const started = performance.now();
    const hits = lintDiagram(`${lines.join("\n")}\n`);
    expect(performance.now() - started).toBeLessThan(250);
    expect(hits.filter((hit) => hit.severity === "error")).toEqual([]);
    expect(hits.some((hit) => hit.ruleId === "unconnected-node")).toBe(false);
  });
});

describe("Mermaid database confirmation", () => {
  it("drops an unconnected warning the database shows as connected", () => {
    const source = "flowchart LR\n  A[Start] --> B[End]\n";
    const merged = mergeAstFacts(source, [{
      ruleId: "unconnected-node",
      severity: "warning",
      subject: "A",
      message: "Node \"A\" is defined but never connected to another node.",
      from: 0,
      to: 1,
      line: 1,
      column: 1,
      fixes: [],
    }], {
      kind: "flowchart",
      nodes: [
        { id: "A", label: "Start" },
        { id: "B", label: "End" },
      ],
      edges: [{ from: "A", to: "B" }],
    });
    expect(merged.some((hit) => hit.ruleId === "unconnected-node" && hit.subject === "A")).toBe(false);
  });

  it("adds a node the database sees and the text scan missed", () => {
    const source = "flowchart LR\n  Hidden[Hidden]\n  A[Start] --> B[End]\n";
    const merged = mergeAstFacts(source, [], {
      kind: "flowchart",
      nodes: [
        { id: "Hidden", label: "Hidden" },
        { id: "A", label: "Start" },
        { id: "B", label: "End" },
      ],
      edges: [{ from: "A", to: "B" }],
    });
    expect(merged.map((hit) => hit.subject)).toEqual(["Hidden"]);
    expect(source.slice(merged[0]?.from, merged[0]?.to)).toBe("Hidden");
  });
});

function collectMmd(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectMmd(full));
    else if (entry.name.endsWith(".mmd")) out.push(full);
  }
  return out;
}

const ANIMAL = `classDiagram
    note "From Duck till Zebra"
    Animal <|-- Duck
    note for Duck "can fly"
    Animal <|-- Fish
    Animal <|-- Zebra
    Animal : +int age
    Animal : +String gender
    Animal: +isMammal()
    Animal: +mate()
    class Duck{
        +String beakColor
        +swim()
        +quack()
    }
    class Fish{
        -int sizeInFeet
        -canEat()
    }
    class Zebra{
        +bool is_wild
        +run()
    }
`;

const ORDER_ER = `erDiagram
    CUSTOMER ||--o{ ORDER : places
    CUSTOMER {
        string name
        string custNumber
        string sector
    }
    ORDER ||--|{ LINE-ITEM : contains
    ORDER {
        int orderNumber
        string deliveryAddress
    }
    LINE-ITEM {
        string productCode
        int quantity
        float pricePerUnit
    }
`;

const GANTT = `gantt
    dateFormat  YYYY-MM-DD
    title       Adding GANTT diagram functionality to mermaid
    excludes    weekends
    section A section
    Completed task            :done,    des1, 2014-01-06,2014-01-08
    Active task               :active,  des2, 2014-01-09, 3d
    Future task               :         des3, after des2, 5d
    Future task2              :         des4, after des3, 5d
    section Critical tasks
    Completed task in the critical line :crit, done, 2014-01-06,24h
    Implement parser and jison          :crit, done, after des1, 2d
    Create tests for parser             :crit, active, 3d
    Future task in critical line        :crit, 5d
    Create tests for renderer           :2d
    Add to mermaid                      :until isadded
    Functionality added                 :milestone, isadded, 2014-01-25, 0d
    section Documentation
    Describe gantt syntax               :active, a1, after des1, 3d
    Add gantt diagram to demo page      :after a1  , 20h
    Add another diagram to demo page    :doc1, after a1  , 48h
    section Last section
    Describe gantt syntax               :after doc1, 3d
    Add gantt diagram to demo page      :20h
    Add another diagram to demo page    :48h
    apple :a, 2017-07-20, 1w
    banana :crit, b, 2017-07-23, 1d
    cherry :active, c, after b a, 1d
    kiwi   :d, 2017-07-20, until b c
`;

describe("class diagrams", () => {
  it("warns when the same class is defined with a different label and can rename or jump", () => {
    const source = 'classDiagram\n  class Animal["Cat"]\n  class Animal["Dog"]\n';
    const hits = byRule(source, "duplicate-class");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("Animal");
    expect(hits[0]?.line).toBe(3);
    expect(source.slice(hits[0]?.from, hits[0]?.to)).toBe("Animal");
    expect(hits[0]?.message).toContain("Dog");
    expect(hits[0]?.message).toContain("Cat");
    const rename = fixNamed(hits[0]!, "rename-duplicate");
    const next = applyEdits(source, rename.edits);
    expect(next).toContain('class Animal2["Dog"]');
    expect(next).toContain('class Animal["Cat"]');
    expect(restored(source, rename)).toBe(source);
    expect(byRule(next, "duplicate-class")).toEqual([]);
    const jump = fixNamed(hits[0]!, "jump-to-definition");
    expect(jump.edits).toEqual([]);
    expect(source.slice(jump.jump?.from, jump.jump?.to)).toBe("Animal");
  });

  it("stays quiet when a class is repeated with the same label or only a member line", () => {
    expect(byRule('classDiagram\n  class Animal["Cat"]\n  class Animal["Cat"]\n', "duplicate-class")).toEqual([]);
    expect(byRule("classDiagram\n  class Animal\n  class Animal {\n    +int age\n  }\n", "duplicate-class")).toEqual([]);
    expect(byRule("classDiagram\n  Animal : +int age\n  class Animal[\"Cat\"]\n", "duplicate-class")).toEqual([]);
    expect(byRule(ANIMAL, "duplicate-class")).toEqual([]);
  });

  it("warns when a relationship names a class that was never declared", () => {
    const source = "classDiagram\n  class Animal\n  Anmal <|-- Duck\n";
    const hits = byRule(source, "undeclared-class");
    expect(hits.map((hit) => hit.subject)).toEqual(["Anmal", "Duck"]);
    const declare = fixNamed(hits[0]!, "declare-class");
    const next = applyEdits(source, declare.edits);
    expect(next).toContain("class Anmal");
    expect(restored(source, declare)).toBe(source);
    expect(byRule(next, "undeclared-class").map((hit) => hit.subject)).toEqual(["Duck"]);
  });

  it("does not warn when every relationship end is declared, or when the diagram only uses relationships", () => {
    expect(byRule("classDiagram\n  Animal <|-- Duck\n  Animal <|-- Fish\n", "undeclared-class")).toEqual([]);
    expect(byRule("classDiagram\n  class Animal\n  class Duck\n  Animal <|-- Duck\n", "undeclared-class")).toEqual([]);
    expect(byRule(ANIMAL, "undeclared-class")).toEqual([]);
    const generic = "classDiagram\n  class Square~Shape~{\n    int id\n  }\n  Square : -List~string~ messages\n  Square --> Circle\n";
    expect(byRule(generic, "undeclared-class").map((hit) => hit.subject)).toEqual(["Circle"]);
  });

  it("can be turned off on its own", () => {
    const source = 'classDiagram\n  class Animal["Cat"]\n  class Animal["Dog"]\n  Anmal <|-- Animal\n';
    const hits = lintDiagram(source, { rules: { "duplicate-class": false } });
    expect(hits.some((hit) => hit.ruleId === "duplicate-class")).toBe(false);
    expect(hits.some((hit) => hit.ruleId === "undeclared-class")).toBe(true);
  });
});

describe("ER diagrams", () => {
  it("warns about a repeated attribute and removes that line", () => {
    const source = "erDiagram\n  CUSTOMER {\n    string name\n    string name PK\n    string email\n  }\n";
    const hits = byRule(source, "duplicate-attribute");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("name");
    expect(hits[0]?.message).toContain("CUSTOMER");
    const remove = fixNamed(hits[0]!, "remove-attribute");
    const next = applyEdits(source, remove.edits);
    expect(next).toContain("string name\n");
    expect(next).not.toContain("string name PK");
    expect(next).toContain("string email");
    expect(restored(source, remove)).toBe(source);
    expect(byRule(next, "duplicate-attribute")).toEqual([]);
  });

  it("does not warn when attribute names differ or live on different entities", () => {
    expect(byRule(ORDER_ER, "duplicate-attribute")).toEqual([]);
    const shared = "erDiagram\n  CUSTOMER {\n    string name\n  }\n  ORDER {\n    string name\n  }\n";
    expect(byRule(shared, "duplicate-attribute")).toEqual([]);
    const keyed = "erDiagram\n  PERSON {\n    string driversLicense PK \"The license #\"\n    string(99) firstName\n    string? middleName\n    string phone UK\n  }\n";
    expect(byRule(keyed, "duplicate-attribute")).toEqual([]);
  });

  it("warns when a relationship names an entity that was never declared", () => {
    const source = "erDiagram\n  CUSTOMER {\n    string name\n  }\n  CUSTMER ||--o{ ORDER : places\n";
    const hits = byRule(source, "undeclared-entity");
    expect(hits.map((hit) => hit.subject)).toEqual(["CUSTMER", "ORDER"]);
    const declare = fixNamed(hits[0]!, "declare-entity");
    const next = applyEdits(source, declare.edits);
    expect(next).toContain("CUSTMER\n");
    expect(restored(source, declare)).toBe(source);
    expect(byRule(next, "undeclared-entity").map((hit) => hit.subject)).toEqual(["ORDER"]);
  });

  it("does not warn for a relationship-only diagram or when every entity is declared", () => {
    const only = "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE-ITEM : contains\n  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses\n";
    expect(byRule(only, "undeclared-entity")).toEqual([]);
    expect(byRule(ORDER_ER, "undeclared-entity")).toEqual([]);
    const words = "erDiagram\n  CAR 1 to zero or more NAMED-DRIVER : allows\n  CAR {\n    string registrationNumber PK\n  }\n  NAMED-DRIVER {\n    string carRegistrationNumber PK, FK\n  }\n";
    expect(byRule(words, "undeclared-entity")).toEqual([]);
    const alias = 'erDiagram\n  p[Person] {\n    string firstName\n  }\n  a["Customer Account"] {\n    string email\n  }\n  p ||--o| a : has\n';
    expect(byRule(alias, "undeclared-entity")).toEqual([]);
    expect(byRule(alias, "duplicate-attribute")).toEqual([]);
  });
});

describe("gantt charts", () => {
  it("warns when a task depends on an id that is never defined", () => {
    const source = "gantt\n  dateFormat YYYY-MM-DD\n  section S\n  Later :b, 2014-01-02, 1d\n  First :a, after missing, 1d\n";
    const hits = byRule(source, "missing-dependency");
    expect(hits.map((hit) => hit.subject)).toEqual(["missing"]);
    expect(hits[0]?.fixes).toEqual([]);
    expect(source.slice(hits[0]?.from, hits[0]?.to)).toBe("missing");
  });

  it("does not warn for a known id, including one defined later, or a normal chart", () => {
    const forward = "gantt\n  dateFormat YYYY-MM-DD\n  First :a, after b, 1d\n  Later :b, 2014-01-02, 1d\n";
    expect(byRule(forward, "missing-dependency")).toEqual([]);
    expect(byRule(GANTT, "missing-dependency")).toEqual([]);
    expect(byRule(GANTT, "invalid-date")).toEqual([]);
  });

  it("warns about a date that does not match dateFormat or is not a real day", () => {
    const source = "gantt\n  dateFormat YYYY-MM-DD\n  section S\n  Bad :a1, 2014-13-01, 1d\n  Leap :a2, 2014-02-31, 1d\n  excludes weekends 2014-02-30\n";
    const hits = byRule(source, "invalid-date");
    expect(hits.map((hit) => hit.subject)).toEqual(["2014-13-01", "2014-02-31", "2014-02-30"]);
    expect(hits[0]?.message).toMatch(/calendar|YYYY-MM-DD/);
    expect(hits.every((hit) => hit.fixes.length === 0)).toBe(true);
    const european = "gantt\n  dateFormat DD-MM-YYYY\n  Task :06-01-2014, 1d\n";
    expect(byRule(european, "invalid-date")).toEqual([]);
    const mismatched = "gantt\n  dateFormat DD-MM-YYYY\n  Task :2014-01-06, 1d\n";
    expect(byRule(mismatched, "invalid-date").map((hit) => hit.subject)).toEqual(["2014-01-06"]);
    const named = "gantt\n  dateFormat MMMM\n  Task :a1, January, 1d\n";
    expect(byRule(named, "invalid-date")).toEqual([]);
    const leap = "gantt\n  dateFormat YYYY-MM-DD\n  Task :2016-02-29, 1d\n";
    expect(byRule(leap, "invalid-date")).toEqual([]);
  });
});

describe("mindmap and timeline", () => {
  it("warns about a repeated mindmap sibling and removes it when it has no children", () => {
    const source = "mindmap\nRoot\n    Apple\n    Apple\n    Orange\n";
    const hits = byRule(source, "duplicate-sibling");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("Apple");
    const remove = fixNamed(hits[0]!, "remove-node");
    const next = applyEdits(source, remove.edits);
    expect(next.match(/Apple/g)).toHaveLength(1);
    expect(next).toContain("Orange");
    expect(restored(source, remove)).toBe(source);
    expect(byRule(next, "duplicate-sibling")).toEqual([]);
  });

  it("does not warn when the same label sits under different parents, or for a normal mindmap", () => {
    const nested = "mindmap\n  root((mindmap))\n    Origins\n      Long history\n      ::icon(fa fa-book)\n      Popularisation\n    Research\n      On effectiveness<br/>and features\n    Tools\n      Pen and paper\n      Mermaid\n";
    expect(byRule(nested, "duplicate-sibling")).toEqual([]);
    expect(byRule(nested, "empty-node")).toEqual([]);
    const cousins = "mindmap\nRoot\n    A\n      Apple\n    B\n      Apple\n";
    expect(byRule(cousins, "duplicate-sibling")).toEqual([]);
    const unclear = "mindmap\nRoot\n    A\n        B\n      C\n";
    expect(byRule(unclear, "duplicate-sibling")).toEqual([]);
  });

  it("warns about an empty mindmap node and removes it only when it has no children", () => {
    const source = "mindmap\nRoot\n    id[]\n    id[Hello]\n";
    const hits = byRule(source, "empty-node");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toMatch(/no text/);
    const remove = fixNamed(hits[0]!, "remove-node");
    const next = applyEdits(source, remove.edits);
    expect(next).not.toContain("id[]");
    expect(next).toContain("id[Hello]");
    expect(byRule(next, "empty-node")).toEqual([]);
    const parent = "mindmap\nRoot\n    id[]\n      Child\n";
    expect(byRule(parent, "empty-node")[0]?.fixes).toEqual([]);
  });

  it("warns about a repeated or empty timeline event and leaves distinct events alone", () => {
    const source = "timeline\n    title History\n    2004 : Facebook\n         : Facebook\n    2005 : YouTube\n";
    const hits = byRule(source, "duplicate-sibling");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("Facebook");
    const remove = fixNamed(hits[0]!, "remove-node");
    const next = applyEdits(source, remove.edits);
    expect(next.match(/Facebook/g)).toHaveLength(1);
    expect(next).toContain("YouTube");
    expect(restored(source, remove)).toBe(source);
    expect(byRule(next, "duplicate-sibling")).toEqual([]);

    const inline = "timeline\n    2004 : Facebook : Facebook\n";
    const inlineHits = byRule(inline, "duplicate-sibling");
    expect(inlineHits).toHaveLength(1);
    const inlineNext = applyEdits(inline, fixNamed(inlineHits[0]!, "remove-node").edits);
    expect(inlineNext).toContain("2004 : Facebook");
    expect(inlineNext.match(/Facebook/g)).toHaveLength(1);

    const empty = "timeline\n    2004 : Facebook\n         :\n";
    const emptyHits = byRule(empty, "empty-node");
    expect(emptyHits).toHaveLength(1);
    const emptied = applyEdits(empty, fixNamed(emptyHits[0]!, "remove-node").edits);
    expect(emptied).not.toMatch(/:\s*$/m);
    expect(byRule(emptied, "empty-node")).toEqual([]);

    const social = "timeline\n    title History of Social Media Platform\n    2002 : LinkedIn\n    2004 : Facebook\n         : Google\n    2005 : YouTube\n    2006 : Twitter\n";
    expect(byRule(social, "duplicate-sibling")).toEqual([]);
    expect(byRule(social, "empty-node")).toEqual([]);
    const ages = `timeline
    title Timeline of Industrial Revolution
    section 17th-20th century
        Industry 1.0 : Machinery, Water power, Steam <br>power
        Industry 2.0 : Electricity, Internal combustion engine, Mass production
    section 21st century
        Industry 4.0 : Internet, Robotics, Internet of Things
        Industry 1.0 : A later note
`;
    expect(byRule(ages, "duplicate-sibling")).toEqual([]);
    expect(byRule(ages, "empty-node")).toEqual([]);
    expect(byRule("timeline\n    2004 : Launch\n    2005 : Launch\n", "duplicate-sibling")).toEqual([]);
  });
});

describe("diagram types without these rules", () => {
  it("leaves block, pie, and journey diagrams to the checks they already have", () => {
    expect(lintDiagram('block-beta\n    columns 1\n    rack["Rack A"]\n    ru01["RU 1 power"]\n')).toEqual([]);
    expect(lintDiagram('pie\n    "LAN" : 40\n    "WAN" : 60\n')).toEqual([]);
    expect(lintDiagram("journey\n    title Day\n    section Morning\n      Read: 5: Me\n")).toEqual([]);
  });
});
