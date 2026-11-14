/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepairLinksDialog } from "../src/components/RepairLinksDialog";
import { ProblemsPanel } from "../src/components/ProblemsPanel";
import type { ReportedDiagnostic } from "../src/lib/mermaidLint";

const previewLinkRepairs = vi.hoisted(() => vi.fn());
const applyLinkRepairs = vi.hoisted(() => vi.fn());

vi.mock("../src/api", () => ({
  api: {
    previewLinkRepairs,
    applyLinkRepairs,
  },
}));

const renamePlan = {
  suggestions: [
    {
      from: "Sites/Atlanta.mmd",
      to: "Sites/Atlanta-Core.mmd",
      match: "content" as const,
      candidates: ["Sites/Atlanta-Core.mmd"],
    },
  ],
  changes: [
    {
      path: "WAN.mmd",
      links: [{ line: 3, target: "nerdgram:Sites/Atlanta.mmd", next: "nerdgram:Sites/Atlanta-Core.mmd" }],
    },
  ],
  applied: false,
  saved: [] as string[],
};

const ambiguousPlan = {
  suggestions: [
    {
      from: "Atlanta.mmd",
      to: null,
      match: "ambiguous" as const,
      candidates: ["East/Atlanta.mmd", "West/Atlanta.mmd"],
    },
  ],
  changes: [],
  applied: false,
  saved: [] as string[],
};

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("repair links dialog", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    previewLinkRepairs.mockReset();
    applyLinkRepairs.mockReset();
  });

  it("shows the preview and writes nothing until Repair links is confirmed", async () => {
    previewLinkRepairs.mockResolvedValue(renamePlan);
    applyLinkRepairs.mockResolvedValue({ ...renamePlan, applied: true, saved: ["WAN.mmd"] });
    const onClose = vi.fn();
    const onApplied = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<RepairLinksDialog onClose={onClose} onApplied={onApplied} />);
    });
    await settle();

    expect(document.body.textContent).toContain("Nothing is written until you confirm.");
    expect(document.body.textContent).toContain("Sites/Atlanta-Core.mmd");
    expect(document.body.textContent).toContain("nerdgram:Sites/Atlanta-Core.mmd");
    expect(applyLinkRepairs).not.toHaveBeenCalled();

    const cancel = [...document.querySelectorAll("button")].find((button) => button.textContent === "Cancel");
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(applyLinkRepairs).not.toHaveBeenCalled();

    const form = document.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(applyLinkRepairs).toHaveBeenCalledWith({
      lockToken: null,
      choices: [{ from: "Sites/Atlanta.mmd", to: "Sites/Atlanta-Core.mmd" }],
    });
    expect(onApplied).toHaveBeenCalledWith(["WAN.mmd"]);
  });

  it("does not offer a choice when the match is ambiguous", async () => {
    previewLinkRepairs.mockResolvedValue(ambiguousPlan);
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<RepairLinksDialog onClose={() => undefined} onApplied={() => undefined} />);
    });
    await settle();

    expect(document.body.textContent).toContain("These matches are ambiguous, so they are not changed.");
    expect(document.body.textContent).toContain("East/Atlanta.mmd");
    expect(document.body.textContent).toContain("West/Atlanta.mmd");
    const submit = document.querySelector<HTMLButtonElement>("button[type='submit']");
    expect(submit?.disabled).toBe(true);
    await act(async () => {
      document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(applyLinkRepairs).not.toHaveBeenCalled();
  });
});

describe("broken-link quick fix", () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("offers Repair links on a broken diagram link", async () => {
    const diagnostic: ReportedDiagnostic = {
      ruleId: "broken-click",
      severity: "warning",
      message: 'The click link "nerdgram:Sites/Atlanta.mmd" does not match a diagram in this workspace.',
      from: 10,
      to: 20,
      line: 3,
      column: 16,
      fixes: [{ id: "repair-links", title: "Repair links", edits: [] }],
    };
    const onFix = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <ProblemsPanel diagnostics={[diagnostic]} onSelect={() => undefined} onFix={onFix} />,
      );
    });
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Repair links");
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFix).toHaveBeenCalledWith(diagnostic.fixes[0]);

    await act(async () => {
      root?.render(
        <ProblemsPanel diagnostics={[diagnostic]} readOnly onSelect={() => undefined} onFix={onFix} />,
      );
    });
    const disabled = [...document.querySelectorAll("button")].find((item) => item.textContent === "Repair links");
    expect(disabled).toBeInstanceOf(HTMLButtonElement);
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
  });
});
