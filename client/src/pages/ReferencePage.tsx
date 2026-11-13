import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Brand } from "../components/Brand";
import { CommandsButton } from "../components/CommandPalette";
import { useCommandHost } from "../components/commandPaletteContext";

type PageMeta = {
  id: string;
  title: string;
  sourceUrl: string;
  filename: string;
};

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Never synced (using bundled seed)";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ReferencePage() {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [attribution, setAttribution] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState("");
  const [override, setOverride] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useCommandHost({
    route: "reference",
    actions: {},
    items: [],
    trashItems: [],
    hasPreview: false,
    autoUpdate: false,
    readOnly: false,
    conflictOpen: false,
  });

  const loadList = async (preferId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.referenceList();
      setPages(data.pages);
      setLastSyncedAt(data.manifest.lastSyncedAt);
      setAttribution(data.manifest.attribution);
      const nextId =
        preferId && data.pages.some((p) => p.id === preferId)
          ? preferId
          : data.pages[0]?.id || "";
      setSelectedId(nextId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reference");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setContent("");
      setTitle("");
      setSourceUrl("");
      setOverride("");
      return;
    }
    let cancelled = false;
    setPageLoading(true);
    void (async () => {
      try {
        const page = await api.referencePage(selectedId);
        if (cancelled) return;
        setContent(page.content);
        setTitle(page.title);
        setSourceUrl(page.sourceUrl);
        setOverride(page.override);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load page");
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.sourceUrl.toLowerCase().includes(q),
    );
  }, [pages, search]);

  const handleSync = async () => {
    setSyncing(true);
    setStatus(null);
    setError(null);
    try {
      const data = await api.referenceSync();
      setPages(data.pages);
      setLastSyncedAt(data.manifest.lastSyncedAt);
      setAttribution(data.manifest.attribution);
      setStatus(
        `Synced ${data.pages.length} pages at ${formatSyncedAt(data.manifest.lastSyncedAt)}`,
      );
      if (selectedId && !data.pages.some((p) => p.id === selectedId)) {
        setSelectedId(data.pages[0]?.id || "");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Sync failed; existing library left unchanged.",
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveOverride = async () => {
    if (!selectedId) return;
    setSavingOverride(true);
    setStatus(null);
    setError(null);
    try {
      const result = await api.referenceOverride(selectedId, override);
      setOverride(result.override);
      setStatus("Local annotation saved (survives sync).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save annotation");
    } finally {
      setSavingOverride(false);
    }
  };

  return (
    <div className="reference-layout">
      <header className="reference-top">
        <div className="reference-top-left">
          <Link to="/">
            <Brand compact />
          </Link>
          <div>
            <h1>Syntax Reference Library</h1>
            <p className="reference-meta">
              Last synced: {formatSyncedAt(lastSyncedAt)}
            </p>
          </div>
        </div>
        <div className="reference-top-actions">
          <CommandsButton />
          <Link className="btn btn-ghost" to="/">
            Back to dashboard
          </Link>
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => void handleSync()}
            disabled={syncing}
          >
            {syncing ? "Syncing…" : "Sync Syntax Reference"}
          </button>
        </div>
      </header>

      {(error || status) && (
        <div
          className={error ? "error-banner" : "status-banner"}
          style={{ margin: "0.75rem 1.25rem 0" }}
        >
          {error || status}
        </div>
      )}

      <div className="reference-body">
        <aside className="reference-toc">
          <div className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search syntax topics"
              aria-label="Search syntax topics"
            />
          </div>
          {loading ? (
            <p className="reference-hint">Loading library…</p>
          ) : filtered.length === 0 ? (
            <p className="reference-hint">No topics match that search.</p>
          ) : (
            <ul className="reference-toc-list">
              {filtered.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    className={`nav-link${selectedId === page.id ? " active" : ""}`}
                    onClick={() => setSelectedId(page.id)}
                  >
                    {page.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="reference-article">
          {pageLoading ? (
            <p className="reference-hint">Loading page…</p>
          ) : !selectedId ? (
            <div className="empty-state">
              No reference pages available yet. Try Sync Syntax Reference while online.
            </div>
          ) : (
            <>
              <div className="reference-article-header">
                <h2>{title}</h2>
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noreferrer">
                    Upstream source
                  </a>
                ) : null}
              </div>
              <article className="markdown-body">
                <Markdown>{content}</Markdown>
              </article>

              <div className="reference-annotation">
                <h3>Local annotation</h3>
                <p className="reference-hint">
                  Optional notes for this page. Annotations are stored separately and survive a full sync replace.
                </p>
                <textarea
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                  rows={5}
                  placeholder="Add a local note…"
                  aria-label="Local annotation"
                />
                <div className="reference-annotation-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleSaveOverride()}
                    disabled={savingOverride}
                  >
                    {savingOverride ? "Saving…" : "Save annotation"}
                  </button>
                </div>
              </div>

              {attribution ? (
                <footer className="reference-attribution">{attribution}</footer>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
