import mermaid from "mermaid";

let initialized = false;
let renderSeq = 0;

export type MermaidTheme = "default" | "neutral" | "dark" | "forest" | "base";

export function initMermaid(theme: MermaidTheme = "neutral") {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme,
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  });
  initialized = true;
}

export function setMermaidTheme(theme: MermaidTheme) {
  initMermaid(theme);
}

export async function renderMermaid(
  code: string,
  theme: MermaidTheme = "neutral",
): Promise<{ svg: string; id: string }> {
  if (!initialized) initMermaid(theme);
  else setMermaidTheme(theme);

  const id = `nerdgram-${++renderSeq}`;
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error("Paste Mermaid markdown to render a diagram.");
  }
  const { svg } = await mermaid.render(id, trimmed);
  return { svg, id };
}
