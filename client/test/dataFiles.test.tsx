import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataFileDialog } from "../src/components/DataFileDialog";
import { dataMoveSentence, deleteDataPrompt, duplicateDataPrompt, duplicateStatus } from "../src/lib/dataFiles";

describe("data file prompts", () => {
  it("describes a move, a copy, and a share", () => {
    expect(dataMoveSentence([])).toBe("");
    expect(dataMoveSentence([{ from: "Sites/Campus.csv", to: "Regions/Campus.csv" }])).toBe(
      "Moved Campus.csv with it.",
    );
    expect(
      dataMoveSentence([
        { from: "Sites/Campus.csv", to: "Regions/Sites/Campus.csv" },
        { from: "Sites/Campus.edges.csv", to: "Regions/Sites/Campus.edges.csv" },
      ]),
    ).toBe("Moved Campus.csv, Campus.edges.csv with it.");
    expect(duplicateStatus("Sites/Campus (copy).mmd", [{ from: "Sites/Campus.csv", to: "Sites/Campus (copy).csv" }], false)).toBe(
      "Duplicated as Sites/Campus (copy).mmd. Copied Campus (copy).csv.",
    );
    expect(duplicateStatus("Sites/Campus (copy).mmd", [], true)).toBe(
      "Duplicated as Sites/Campus (copy).mmd. It shares the original data file.",
    );
  });

  it("offers copy or share, and trash or keep", () => {
    const copy = duplicateDataPrompt();
    expect(copy.primaryLabel).toBe("Copy the data file");
    expect(copy.secondaryLabel).toBe("Share the original");
    const remove = deleteDataPrompt();
    expect(remove.primaryLabel).toBe("Trash the data file");
    expect(remove.secondaryLabel).toBe("Keep the data file");

    const html = renderToStaticMarkup(
      createElement(DataFileDialog, {
        title: copy.title,
        intro: copy.intro,
        files: ["Sites/Campus.lldp"],
        primaryLabel: copy.primaryLabel,
        secondaryLabel: copy.secondaryLabel,
        onClose: () => undefined,
        onPrimary: () => undefined,
        onSecondary: () => undefined,
      }),
    );
    expect(html).toContain("Copy the data file?");
    expect(html).toContain("Sites/Campus.lldp");
    expect(html).toContain("Copy the data file");
    expect(html).toContain("Share the original");
    expect(html).toContain("Cancel");
  });
});
