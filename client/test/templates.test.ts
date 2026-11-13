/**
 * @vitest-environment happy-dom
 *
 * Mermaid's renderer needs a DOM. happy-dom is only used here so every bundled
 * template is parsed and drawn with the mermaid version the client ships.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diagramInitConfig, MERMAID_THEMES, parseDiagram } from "../src/lib/frontMatter";
import { renderMermaid } from "../src/lib/mermaidRender";

const templatesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates");

/**
 * happy-dom reports a zero box for SVG text, and Mermaid treats that as "not
 * in the render tree". A real browser measures the text. Give the test a
 * non-zero box so sequence layout can finish.
 */
function installTextBox(): void {
  const box = function (this: Element) {
    const text = this.textContent ?? "";
    const width = Math.max(8, text.trim().length * 7);
    const height = text.trim() ? 18 : 8;
    return new DOMRect(0, 0, width, height);
  };
  const ctors = [globalThis.SVGElement, globalThis.SVGGraphicsElement, globalThis.SVGSVGElement].filter(
    (ctor): ctor is typeof SVGElement => typeof ctor === "function",
  );
  for (const ctor of ctors) {
    Object.defineProperty(ctor.prototype, "getBBox", {
      configurable: true,
      value: box,
    });
  }
}

const EXPECTED = [
  "firewall-policy.mmd",
  "flowchart-starter.mmd",
  "home-lab.mmd",
  "network-topology.mmd",
  "rack-elevation.mmd",
  "sequence-starter.mmd",
];

describe("bundled templates render", () => {
  it(
    "parses and renders every template with its front-matter theme",
    async () => {
      installTextBox();
      const names = (await fs.readdir(templatesDir)).filter((name) => name.endsWith(".mmd")).sort();
      expect(names).toEqual(EXPECTED);
      for (const name of names) {
        const source = await fs.readFile(path.join(templatesDir, name), "utf8");
        const parsed = parseDiagram(source);
        expect(parsed.malformed, name).toBe(false);
        expect(parsed.theme, name).toBeTruthy();
        expect(MERMAID_THEMES, name).toContain(parsed.theme);
        expect(diagramInitConfig(source).theme, name).toBe(parsed.theme);
        const rendered = await renderMermaid(source);
        expect(rendered.svg, name).toContain("<svg");
        expect(rendered.svg.toLowerCase(), name).not.toContain("syntax error");
      }
    },
    60_000,
  );
});
