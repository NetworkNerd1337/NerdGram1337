import { useEffect, useState } from "react";
import { api } from "../api";
import { FALLBACK_THEME, thumbnailCacheKey } from "../lib/frontMatter";
import { renderMermaid } from "../lib/mermaidRender";

type MermaidThumbnailProps = {
  path: string;
};

const MAX_THUMBNAILS = 80;
const thumbnailCache = new Map<string, string>();

function rememberThumbnail(key: string, svg: string) {
  if (thumbnailCache.has(key)) thumbnailCache.delete(key);
  thumbnailCache.set(key, svg);
  while (thumbnailCache.size > MAX_THUMBNAILS) {
    const oldest = thumbnailCache.keys().next().value;
    if (oldest == null) break;
    thumbnailCache.delete(oldest);
  }
}

export function MermaidThumbnail({ path }: MermaidThumbnailProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const file = await api.readFile(path);
        if (!file.content.trim()) {
          if (!cancelled) {
            setSvg(null);
            setFailed(false);
          }
          return;
        }
        const key = thumbnailCacheKey(file.content);
        const cached = thumbnailCache.get(key);
        if (cached) {
          if (!cancelled) {
            setSvg(cached);
            setFailed(false);
          }
          return;
        }
        const result = await renderMermaid(file.content, FALLBACK_THEME);
        rememberThumbnail(key, result.svg);
        if (!cancelled) {
          setSvg(result.svg);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="card-thumb">
      {svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <span className="empty">{failed ? "Preview unavailable" : "Empty diagram"}</span>
      )}
    </div>
  );
}
