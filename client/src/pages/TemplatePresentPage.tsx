import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { PresentationView } from "../components/PresentationView";
import { useCommandHost } from "../components/commandPaletteContext";
import { DIAGRAM_MISSING_MESSAGE } from "../lib/presentPoll";

/**
 * Present a bundled template without copying it into the workspace.
 * The file is read once. Bundled templates are not edited from this view.
 */
export function TemplatePresentPage() {
  const params = useParams();
  const id = params.id || "";
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<{
    id: string;
    source: string | null;
    error: string | null;
  } | null>(null);
  const current = loaded?.id === id ? loaded : null;

  useCommandHost({
    route: "other",
    actions: {},
    items: [],
    trashItems: [],
    hasPreview: Boolean(current?.source),
    autoUpdate: false,
    readOnly: true,
    conflictOpen: false,
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void api.template(id).then(
      (template) => {
        if (!cancelled) setLoaded({ id, source: template.source, error: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError && err.status === 404
            ? DIAGRAM_MISSING_MESSAGE
            : err instanceof Error
              ? err.message
              : "Could not open this template";
        setLoaded({ id, source: null, error: message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const source = !id ? "" : current?.error ? "" : (current?.source ?? null);
  const fileError = !id ? DIAGRAM_MISSING_MESSAGE : (current?.error ?? null);

  return (
    <PresentationView
      source={source}
      path={id || "template"}
      fileError={fileError}
      onExit={() => navigate("/templates")}
    />
  );
}
