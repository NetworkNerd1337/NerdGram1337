import { describe, expect, it } from "vitest";
import { svgForImage } from "../../server/src/svgImage.ts";

describe("thumbnail svg", () => {
  it("adds the xlink namespace a click link needs before it can be an image", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="nerdgram:Sites/Atlanta.mmd"><text>Atlanta</text></a></svg>`;
    const fixed = svgForImage(svg);
    expect(fixed.startsWith('<svg xmlns:xlink="http://www.w3.org/1999/xlink"')).toBe(true);
    expect(fixed).toContain("Atlanta");
  });
});
