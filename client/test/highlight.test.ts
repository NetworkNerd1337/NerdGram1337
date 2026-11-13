import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HighlightedText } from "../src/components/HighlightedText";
import { editorHref } from "../src/lib/diagramSearch";

describe("search snippets", () => {
  it("highlights a match as text and escapes markup from the file", () => {
    const text = '<img src=x onerror="alert(1)"> Firewall';
    const start = text.indexOf("Firewall");
    const html = renderToStaticMarkup(
      createElement(HighlightedText, { text, start, length: "Firewall".length }),
    );
    expect(html).toContain("<mark>Firewall</mark>");
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/<img\b/i);
    expect(html.replace(/<\/?mark>/g, "")).not.toMatch(/<[a-z]/i);
  });

  it("builds an editor link that opens the matching line", () => {
    expect(editorHref("Examples/Sequence.mmd", 8, "SVG preview")).toBe(
      "/edit/Examples/Sequence.mmd?line=8&find=SVG+preview",
    );
    expect(editorHref("Welcome.mmd", null, "")).toBe("/edit/Welcome.mmd");
  });
});
