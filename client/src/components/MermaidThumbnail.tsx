import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, api } from "../api";
import { FALLBACK_THEME, thumbnailCacheKey } from "../lib/frontMatter";
import { renderMermaid } from "../lib/mermaidRender";
import { lookupThumbnailRecord, rememberThumbnail, scheduleThumbnail } from "../lib/thumbnailCache";

type MermaidThumbnailProps = {
  path: string;
  mtimeMs: number;
  cacheKey?: string | null;
};

type Status = "pending" | "ready" | "empty" | "failed";

class ThumbnailBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="card-thumb">
          <span className="empty">Preview unavailable</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function ThumbnailBody({ path, mtimeMs, cacheKey }: MermaidThumbnailProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [loaded, setLoaded] = useState<{
    token: string;
    svg: string | null;
    status: Status;
  } | null>(null);
  const token = `${path}\0${mtimeMs}\0${cacheKey ?? ""}`;
  const memory = lookupThumbnailRecord(path, mtimeMs, cacheKey);
  const shown =
    loaded?.token === token
      ? loaded
      : {
          token,
          svg: memory?.status === "ready" ? memory.svg : null,
          status: (memory ? memory.status : "pending") as Status,
        };

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cached = lookupThumbnailRecord(path, mtimeMs, cacheKey);
    if (cached) return;
    if (!visible) return;

    const controller = new AbortController();
    let cancelled = false;
    const requestToken = `${path}\0${mtimeMs}\0${cacheKey ?? ""}`;

    void scheduleThumbnail(async () => {
      if (cancelled || controller.signal.aborted) return;
      try {
        const server = await api.thumbnail(path);
        if (cancelled) return;
        if (server.hit && server.svg) {
          rememberThumbnail({
            path,
            cacheKey: server.cacheKey,
            mtimeMs: server.mtimeMs,
            svg: server.svg,
            status: "ready",
          });
          if (!cancelled) setLoaded({ token: requestToken, svg: server.svg, status: "ready" });
          return;
        }
      } catch (err) {
        if (cancelled) return;
        if (!(err instanceof ApiError)) {
          setLoaded({ token: requestToken, svg: null, status: "failed" });
          return;
        }
      }

      try {
        const file = await api.readFile(path);
        if (cancelled) return;
        const key = thumbnailCacheKey(file.content);
        if (!file.content.trim()) {
          rememberThumbnail({
            path,
            cacheKey: key,
            mtimeMs: file.mtimeMs,
            svg: null,
            status: "empty",
          });
          setLoaded({ token: requestToken, svg: null, status: "empty" });
          return;
        }
        const warmed = lookupThumbnailRecord(path, file.mtimeMs, key);
        if (warmed) {
          setLoaded({
            token: requestToken,
            svg: warmed.status === "ready" ? warmed.svg : null,
            status: warmed.status,
          });
          return;
        }
        const rendered = await renderMermaid(file.content, FALLBACK_THEME);
        if (cancelled) return;
        rememberThumbnail({
          path,
          cacheKey: key,
          mtimeMs: file.mtimeMs,
          svg: rendered.svg,
          status: "ready",
        });
        setLoaded({ token: requestToken, svg: rendered.svg, status: "ready" });
        void api.saveThumbnail(path, key, rendered.svg).catch(() => undefined);
      } catch {
        if (!cancelled) {
          const key = cacheKey ?? "";
          if (key) {
            rememberThumbnail({
              path,
              cacheKey: key,
              mtimeMs,
              svg: null,
              status: "failed",
            });
          }
          setLoaded({ token: requestToken, svg: null, status: "failed" });
        }
      }
    }, controller.signal).catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [visible, path, mtimeMs, cacheKey]);

  const message =
    shown.status === "failed" ? "Preview unavailable" : shown.status === "empty" ? "Empty diagram" : "";

  return (
    <div className="card-thumb" ref={rootRef} aria-busy={shown.status === "pending"}>
      {shown.svg ? (
        <div dangerouslySetInnerHTML={{ __html: shown.svg }} />
      ) : (
        <span className="empty">{message}</span>
      )}
    </div>
  );
}

export function MermaidThumbnail(props: MermaidThumbnailProps) {
  return (
    <ThumbnailBoundary>
      <ThumbnailBody {...props} />
    </ThumbnailBoundary>
  );
}
