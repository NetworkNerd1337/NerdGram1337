/**
 * Mermaid writes `xlink:href` on a `click` node and does not declare the
 * xlink namespace. An `<img>` parses that SVG as XML, rejects it, and draws
 * nothing. The editor preview inserts the same markup as HTML, which is why
 * the preview still shows the diagram.
 */
export function svgForImage(svg: string): string {
  if (!/xlink:/i.test(svg) || /xmlns:xlink\s*=/i.test(svg)) return svg;
  return svg.replace(/<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
}
