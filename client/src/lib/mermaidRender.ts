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
  return enqueue(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      throw new Error("Paste Mermaid markdown to render a diagram.");
    }
    initializeFor(trimmed, FALLBACK_THEME);
    await mermaid.parse(trimmed);
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
