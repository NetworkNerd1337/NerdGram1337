import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReleaseMarkdown } from "../src/components/ReleaseMarkdown";

describe("release notes rendering", () => {
  it("renders markdown and does not inject raw HTML", () => {
    const html = renderToStaticMarkup(
      createElement(ReleaseMarkdown, {
        markdown: [
          "<script>alert(1)</script>",
          "",
          "<img src=x onerror=alert(1)>",
          "",
          "[click](javascript:alert(1))",
          "",
          "[notes](https://github.com/NetworkNerd1337/NerdGram1337/releases/tag/v1.2.0)",
          "",
          "**safe**",
        ].join("\n"),
      }),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain("<strong>safe</strong>");
    expect(html).toContain("https://github.com/NetworkNerd1337/NerdGram1337/releases/tag/v1.2.0");
  });
});
