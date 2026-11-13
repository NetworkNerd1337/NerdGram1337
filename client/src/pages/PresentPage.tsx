import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { PresentationView } from "../components/PresentationView";
import { useCommandHost } from "../components/commandPaletteContext";
import type { FilePayload } from "../types";

const POLL_MS = 2000;

/**
 * Read-only presentation route. It loads through the existing file API and
 * does not acquire an edit lock, autosave, or write the file.
 */
export function PresentPage() {
  const params = useParams();
  const filePath = params["*"] || "";
  const navigate = useNavigate();
  const location = useLocation();
  const [file, setFile] = useState<FilePayload | null>(null);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);

  const exit = useCallback(() => {
    if (location.key === "default") navigate("/", { replace: true });
    else navigate(-1);
  }, [location.key, navigate]);

  useCommandHost({
    route: "other",
    actions: {},
    items: [],
    trashItems: [],
    hasPreview: Boolean(file?.content),
    autoUpdate: false,
    readOnly: true,
    conflictOpen: false,
  });

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api.readFile(filePath);
        if (cancelled) return;
        setError((current) => (current?.path === filePath ? null : current));
        setFile((current) => (current?.path === next.path && current.hash === next.hash ? current : next));
      } catch (err) {
        if (cancelled) return;
        setError({
          path: filePath,
          message: err instanceof Error ? err.message : "Could not open this diagram",
        });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [filePath]);

  const current = file?.path === filePath ? file : null;
  const currentError = error?.path === filePath ? error.message : null;
  const source = !filePath ? "" : current ? current.content : currentError ? "" : null;

  return (
    <PresentationView
      source={source}
      path={filePath}
      fileError={filePath ? currentError : "Missing diagram path"}
      onExit={exit}
    />
  );
}
