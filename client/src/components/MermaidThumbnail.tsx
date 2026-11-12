import { useEffect, useState } from "react";
import { api } from "../api";
import { renderMermaid } from "../lib/mermaidRender";

type MermaidThumbnailProps = {
  path: string;
};

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
        const result = await renderMermaid(file.content, "dark");
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
