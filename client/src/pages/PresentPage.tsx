import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { PresentationView } from "../components/PresentationView";
import { useCommandHost } from "../components/commandPaletteContext";
import { presentPollDecision } from "../lib/presentPoll";
import type { FilePayload } from "../types";

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
    let timer = 0;
    let failures = 0;

    function schedule(delayMs: number) {
      timer = window.setTimeout(() => {
        void load();
      }, delayMs);
    }

    async function load() {
      try {
        const next = await api.readFile(filePath);
        if (cancelled) return;
        const decision = presentPollDecision({ ok: true, status: null, failures });
        failures = decision.failures;
        setError((current) => (current?.path === filePath ? null : current));
        setFile((current) => (current?.path === next.path && current.hash === next.hash ? current : next));
        schedule(decision.delayMs);
      } catch (err) {
        if (cancelled) return;
        const decision = presentPollDecision({
          ok: false,
          status: err instanceof ApiError ? err.status : null,
          failures,
          errorMessage: err instanceof Error ? err.message : "Could not open this diagram",
        });
        failures = decision.failures;
        setError({
          path: filePath,
          message: decision.message ?? "Could not open this diagram",
        });
        if (decision.stop) {
          setFile((current) => (current?.path === filePath ? null : current));
          return;
        }
        schedule(decision.delayMs);
      }
    }

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
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
