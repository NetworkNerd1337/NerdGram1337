import { describe, expect, it } from "vitest";
import { sanitizeThumbnailSvg } from "../src/thumbnails.js";
import { svgForImage } from "../src/svgImage.js";

const CLICK_SVG = `<svg id="n" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><g class="node" id="flowchart-Atlanta-0"><a xlink:href="nerdgram:Sites/Atlanta.mmd"><rect width="40" height="20"/><text>Atlanta</text></a></g></svg>`;

describe("svg as an image", () => {
  it("declares the xlink namespace so a click link does not blank the thumbnail", () => {
    const fixed = svgForImage(CLICK_SVG);
    expect(fixed).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(fixed).toContain("Atlanta");
    expect(fixed).toContain("nerdgram:Sites/Atlanta.mmd");
    expect(svgForImage(fixed)).toBe(fixed);
    expect(svgForImage(`<svg xmlns="http://www.w3.org/2000/svg"><text>Core</text></svg>`)).not.toContain("xmlns:xlink");
  });

  it("keeps the namespace when a click diagram is stored as a thumbnail", () => {
    const stored = sanitizeThumbnailSvg(CLICK_SVG);
    expect(stored).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(stored).toContain("Atlanta");
  });
});
