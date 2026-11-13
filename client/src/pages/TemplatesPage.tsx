import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Brand } from "../components/Brand";
import { CommandsButton } from "../components/CommandPalette";
import { FolderPicker } from "../components/FolderPicker";
import { Modal } from "../components/Modal";
import { SourceThumbnail } from "../components/MermaidThumbnail";
import { useCommandHost } from "../components/commandPaletteContext";
import { useWorkspace } from "../hooks/useWorkspace";
import { filterTemplates, folderInTree, templatePresentHref, uniqueSorted } from "../lib/templateGallery";
import type { TemplateSummary } from "../types";

export function TemplatesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tree, loading: treeLoading } = useWorkspace();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [diagramType, setDiagramType] = useState("");
  const [tag, setTag] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [namedFor, setNamedFor] = useState<string | null>(null);
  const [folderChoice, setFolderChoice] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestedFolder = searchParams.get("folder") ?? "";
  const folder =
    folderChoice ??
    (treeLoading || folderInTree(tree, requestedFolder) ? requestedFolder : "");

  useCommandHost({
    route: "other",
    actions: {
      newDiagram: () => navigate("/?new=diagram"),
    },
    items: [],
    trashItems: [],
    hasPreview: false,
    autoUpdate: false,
    readOnly: false,
    conflictOpen: false,
  });

  useEffect(() => {
    let cancelled = false;
    void api
      .templates()
      .then((result) => {
        if (cancelled) return;
        setTemplates(result.templates);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load templates");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => uniqueSorted(templates.map((item) => item.category)), [templates]);
  const types = useMemo(() => uniqueSorted(templates.map((item) => item.diagramType)), [templates]);
  const tags = useMemo(() => uniqueSorted(templates.flatMap((item) => item.tags)), [templates]);
  const shown = useMemo(
    () => filterTemplates(templates, { query, category, diagramType, tag }),
    [templates, query, category, diagramType, tag],
  );
  const requestedUse = searchParams.get("use") ?? "";
  const linked = templates.find((item) => item.id === requestedUse) ?? null;
  const picked = templates.find((item) => item.id === pickedId) ?? null;
  const selected = picked ?? linked;
  const unknownTemplate = !loading && requestedUse.length > 0 && !linked && !picked;
  if (selected && namedFor !== selected.id) {
    setNamedFor(selected.id);
    setName(selected.title);
    setDialogError(null);
  }

  const openUse = (template: TemplateSummary) => {
    setPickedId(template.id);
  };

  const closeDialog = () => {
    if (saving) return;
    setPickedId(null);
    setNamedFor(null);
    if (!searchParams.has("use")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("use");
    setSearchParams(next, { replace: true });
  };

  const create = async () => {
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setDialogError(null);
    try {
      const result = await api.createFromTemplate(selected.id, { name, folder });
      navigate(`/edit/${result.path}`);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Could not create the diagram");
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="reference-layout">
      <header className="reference-top">
        <div className="reference-top-left">
          <Link to="/" aria-label="Dashboard">
            <Brand />
          </Link>
          <h1>Template gallery</h1>
        </div>
        <div className="reference-top-actions">
          <Link className="btn btn-ghost" to="/">
            Dashboard
          </Link>
          <Link className="btn btn-ghost" to="/new">
            Paste Mermaid
          </Link>
          <CommandsButton />
        </div>
      </header>

      <main className="template-main">
        <p className="template-intro">
          Pick a starter. Use template copies it into a folder you choose and opens the copy in the
          editor. The original stays in the gallery.
        </p>
        {error || unknownTemplate ? (
          <div className="error-banner">{error || "That template is not available."}</div>
        ) : null}

        <div className="template-toolbar">
          <div className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, description, tags, category, or type"
              aria-label="Search templates"
            />
          </div>
          <label className="template-select">
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
              <option value="">All</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="template-select">
            Diagram type
            <select
              value={diagramType}
              onChange={(event) => setDiagramType(event.target.value)}
              aria-label="Filter by diagram type"
            >
              <option value="">All</option>
              {types.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="template-select">
            Tag
            <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Filter by tag">
              <option value="">All</option>
              {tags.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? <p>Loading templates…</p> : null}
        {!loading && shown.length === 0 ? (
          <div className="empty-state">No templates match that search.</div>
        ) : (
          <div className="card-grid">
            {shown.map((template) => (
              <article className="card template-card" key={template.id}>
                <SourceThumbnail id={template.id} source={template.source} cacheKey={template.cacheKey} />
                <div className="card-body">
                  <h3>{template.title}</h3>
                  <p className="card-description">
                    {template.malformed
                      ? template.error || "This template could not be read."
                      : template.description}
                  </p>
                  <p className="template-meta">
                    <span>{template.category || "General"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{template.diagramType}</span>
                  </p>
                  {template.tags.length > 0 ? (
                    <div className="tag-row">
                      {template.tags.map((item) => (
                        <span className="tag-chip" key={item}>
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="card-actions">
                    <button type="button" className="btn btn-primary" onClick={() => openUse(template)}>
                      Use template
                    </button>
                    <Link className="btn btn-ghost" to={templatePresentHref(template.id)}>
                      Present
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {selected ? (
        <Modal
          className="modal-wide"
          title={`Use ${selected.title}`}
          confirmLabel={saving ? "Creating…" : "Create diagram"}
          onClose={closeDialog}
          onConfirm={() => void create()}
        >
          <p className="template-dialog-note">
            If that name is already in the folder, a number is added and the existing diagram is
            kept.
          </p>
          {dialogError ? <div className="error-banner">{dialogError}</div> : null}
          <label htmlFor="template-name">Diagram name</label>
          <input
            id="template-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <div className="template-folder-label">Folder</div>
          <FolderPicker tree={tree} value={folder} onChange={setFolderChoice} />
        </Modal>
      ) : null}
    </div>
  );
}
