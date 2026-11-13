/**
 * Presentation surface color. The rendered SVG is the source of truth so a
 * file theme (forest, default, neutral, …) is not forced onto the editor grid.
 * The map covers the first frame, before that SVG exists.
 */

/** Mermaid's built-in theme page colors. Forest and default are light. */
const THEME_BACKGROUNDS: Record<string, string> = {
  default: "#f4f4f4",
  neutral: "#ffffff",
  dark: "#333333",
  forest: "#ffffff",
  base: "#ffffff",
  neo: "#ffffff",
  "neo-dark": "#141414",
  redux: "#ffffff",
  "redux-dark": "#333333",
  "redux-color": "#ffffff",
  "redux-dark-color": "#333333",
};

const IGNORED_COLORS = new Set(["none", "transparent", "initial", "inherit", "unset"]);

function usableColor(value: string | undefined): string | null {
  if (!value) return null;
  const color = value.replace(/!important/gi, "").trim();
  if (!color || IGNORED_COLORS.has(color.toLowerCase()) || color.startsWith("url(")) return null;
  return color;
}

/**
 * Color painted inside the SVG. Mermaid often sets `background-color: transparent`
 * on the SVG, which must not win: a fullscreen element with a transparent
 * background is painted black by the browser.
 */
export function backgroundFromSvg(svg: string): string | null {
  for (const match of svg.matchAll(/(?:background-color|background)\s*:\s*([^;}"]+)/gi)) {
    const color = usableColor(match[1]);
    if (color) return color;
  }
  const tagged = svg.match(/<rect\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*>/i);
  if (tagged) {
    const fill = tagged[0].match(/\bfill="([^"]+)"/i) ?? tagged[0].match(/fill:\s*([^;}"]+)/i);
    const color = usableColor(fill?.[1]);
    if (color) return color;
  }
  return null;
}

export function themeBackground(
  theme: string | null | undefined,
  variables?: Record<string, unknown> | null,
): string | null {
  const fromVar = variables?.background;
  if (typeof fromVar === "string" && fromVar.trim()) return fromVar.trim();
  if (!theme) return null;
  return THEME_BACKGROUNDS[theme] ?? null;
}
