function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function cloneSvg(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  return clone;
}

function svgToString(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(cloneSvg(svg));
}

async function svgToCanvas(
  svg: SVGSVGElement,
  background: string | null,
): Promise<HTMLCanvasElement> {
  const bbox = svg.getBoundingClientRect();
  const width = Math.max(
    1,
    Math.ceil(Number(svg.viewBox.baseVal?.width) || bbox.width || svg.clientWidth || 800),
  );
  const height = Math.max(
    1,
    Math.ceil(
      Number(svg.viewBox.baseVal?.height) || bbox.height || svg.clientHeight || 600,
    ),
  );

  const clone = cloneSvg(svg);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const svgText = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to rasterize SVG"));
      img.src = url;
    });

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported");
    ctx.scale(scale, scale);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type ExportFormat = "svg" | "png" | "jpg";

export async function exportDiagram(
  svg: SVGSVGElement,
  baseName: string,
  format: ExportFormat,
): Promise<void> {
  const safe = (baseName || "diagram").replace(/[^\w.-]+/g, "_");

  if (format === "svg") {
    const text = svgToString(svg);
    triggerDownload(
      new Blob([text], { type: "image/svg+xml;charset=utf-8" }),
      `${safe}.svg`,
    );
    return;
  }

  const canvas = await svgToCanvas(svg, format === "jpg" ? "#ffffff" : null);
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
      mime,
      0.92,
    );
  });
  triggerDownload(blob, `${safe}.${format === "jpg" ? "jpg" : "png"}`);
}
