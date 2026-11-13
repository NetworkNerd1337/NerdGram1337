import { describe, expect, it } from "vitest";
import { formatVersionLabel } from "../src/lib/versionLabel";

describe("version label", () => {
  it("prints the version and a safe code name", () => {
    expect(formatVersionLabel("1.0.5", "Atlas")).toBe('v1.0.5 "Atlas"');
    expect(formatVersionLabel("v2.0.0", "Meridian")).toBe('v2.0.0 "Meridian"');
    expect(formatVersionLabel("3.0.0", null)).toBe("v3.0.0");
    expect(formatVersionLabel("3.0.0", "<script>")).toBe("v3.0.0");
    expect(formatVersionLabel("3.0.0", "harbor")).toBe("v3.0.0");
  });
});
