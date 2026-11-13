import { describe, expect, it } from "vitest";
import { backgroundFromSvg, themeBackground } from "../src/lib/svgBackground";

describe("presentation background", () => {
  it("reads a real diagram background and ignores a transparent SVG", () => {
    const svg = `<svg style="background-color: transparent;"><style>#id { background-color: #cde498; }</style></svg>`;
    expect(backgroundFromSvg(svg)).toBe("#cde498");
    expect(backgroundFromSvg(`<svg style="background-color: transparent;"></svg>`)).toBeNull();
    expect(backgroundFromSvg(`<svg style="background-color: rgb(51, 51, 51);"></svg>`)).toBe(
      "rgb(51, 51, 51)",
    );
    expect(backgroundFromSvg("<svg></svg>")).toBeNull();
  });

  it("falls back to the file theme, then a theme variable", () => {
    expect(themeBackground("forest")).toBe("#ffffff");
    expect(themeBackground("dark")).toBe("#333333");
    expect(themeBackground("default")).toBe("#f4f4f4");
    expect(themeBackground("forest", { background: "#ddeedd" })).toBe("#ddeedd");
    expect(themeBackground(null)).toBeNull();
  });
});
