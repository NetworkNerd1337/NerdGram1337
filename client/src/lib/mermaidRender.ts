import mermaid from "mermaid";
import { diagramInitConfig, FALLBACK_THEME } from "./frontMatter";

let renderSeq = 0;
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Mermaid parks a temporary SVG on document.body. Drop it after every render. */
function removeMermaidTemp(id: string): void {
  if (typeof document === "undefined") return;
  for (const elementId of [id, `d${id}`, `i${id}`]) {
    document.getElementById(elementId)?.remove();
  }
}

function initializeFor(code: string, fallbackTheme: string): void {
  const config = diagramInitConfig(code, fallbackTheme);
  mermaid.initialize(config as Parameters<typeof mermaid.initialize>[0]);
}

export async function parseMermaid(code: string): Promise<void> {
  const inspected = await inspectMermaid(code);
  if (!inspected.ok) throw inspected.error instanceof Error ? inspected.error : new Error(String(inspected.error));
}

export type MermaidInspection =
  | { ok: true; diagram: unknown }
  | { ok: false; error: unknown };

/**
 * Parse the diagram text Mermaid received, without trimming, so a failure's
 * line and column refer to the editor buffer. Returns the diagram database
 * when Mermaid built one.
 */
export async function inspectMermaid(code: string): Promise<MermaidInspection> {
  return enqueue(async () => {
    if (!code.trim()) {
      return { ok: false, error: new Error("Paste Mermaid markdown to render a diagram.") };
    }
    initializeFor(code, FALLBACK_THEME);
    const api = (mermaid as { mermaidAPI?: { getDiagramFromText?: (text: string) => Promise<unknown> } }).mermaidAPI;
    try {
      if (api?.getDiagramFromText) {
        const diagram = await api.getDiagramFromText(code);
        return { ok: true, diagram };
      }
      await mermaid.parse(code);
      return { ok: true, diagram: null };
    } catch (error) {
      return { ok: false, error };
    }
  });
}

/**
 * Render a diagram. `fallbackTheme` is used only when the file does not set
 * `config.theme` (or a diagram-type theme). Front matter and `%%{init}%%`
 * are applied by initializing with that config before `mermaid.render`, so a
 * file theme wins over the app fallback.
 */
export async function renderMermaid(
  code: string,
  fallbackTheme: string = FALLBACK_THEME,
): Promise<{ svg: string; id: string }> {
  return enqueue(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      throw new Error("Paste Mermaid markdown to render a diagram.");
    }
    initializeFor(trimmed, fallbackTheme);
    const id = `nerdgram-${++renderSeq}`;
    try {
      const { svg } = await mermaid.render(id, trimmed);
      return { svg, id };
    } finally {
      removeMermaidTemp(id);
    }
  });
}
