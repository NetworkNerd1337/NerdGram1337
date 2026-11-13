import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, api } from "../api";
import { requestUpdateReload } from "../lib/updateReload";
import type { UpdateJob, UpdateStatus } from "../types";
import { ReleaseMarkdown } from "./ReleaseMarkdown";
import { UpdateContext, useUpdate, type UpdatePanel } from "./updateContext";

const TARGET_KEY = "nerdgram-update-target";

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "The update request failed.";
}

function shortCommit(commit: string | null): string | null {
  if (!commit) return null;
  return commit.slice(0, 7);
}

export function UpdateHost({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [panel, setPanel] = useState<UpdatePanel>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(() => document.body.dataset.presenting === "true");
  const [dockerGuide, setDockerGuide] = useState<UpdateStatus["docker"]>(null);

  const applyStatus = useCallback((next: UpdateStatus) => {
    setStatus(next);
    const target = sessionStorage.getItem(TARGET_KEY);
    if (target && next.currentVersion === target) {
      sessionStorage.removeItem(TARGET_KEY);
      setNotice(`NerdGram ${next.currentVersion} is running. This install matches the release you updated to.`);
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await api.updates();
    applyStatus(next);
    return next;
  }, [applyStatus]);

  const checkNow = useCallback(async (options?: { keepPanel?: boolean }) => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await api.checkUpdates();
      applyStatus(next);
      if (options?.keepPanel) {
        if (next.error) setActionError(next.error.message);
        return;
      }
      if (next.error) {
        setActionError(next.error.message);
        setPanel("about");
        return;
      }
      if (next.phase === "disabled") {
        setNotice("Update checks are turned off.");
        setPanel("about");
        return;
      }
      if (next.updateAvailable && !next.dismissed) {
        setPanel(null);
        return;
      }
      if (next.matchesLatest || next.phase === "current") {
        setNotice(`NerdGram ${next.currentVersion} is up to date.`);
      } else if (next.phase === "ahead") {
        setNotice(`This build (${next.currentVersion}) is newer than the latest stable release.`);
      } else if (next.phase === "no_release") {
        setNotice("No stable release has been published yet.");
      } else if (next.skipped) {
        setNotice(
          `Version ${next.latest?.version ?? ""} is skipped. Reset skipped versions in About to see it again.`.trim(),
        );
      }
      setPanel("about");
    } catch (err) {
      setActionError(messageOf(err));
      if (!options?.keepPanel) setPanel("about");
    } finally {
      setBusy(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void refresh().catch(() => undefined);
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(load, 15 * 60 * 1000);
    let attempts = 0;
    const early = window.setInterval(() => {
      attempts += 1;
      if (cancelled || attempts > 15) {
        window.clearInterval(early);
        return;
      }
      load();
    }, 2000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
      window.clearInterval(early);
    };
  }, [refresh]);

  useEffect(() => {
    const onAbout = () => setPanel("about");
    const onCheck = () => {
      void checkNow();
    };
    window.addEventListener("nerdgram:about", onAbout);
    window.addEventListener("nerdgram:check-updates", onCheck);
    return () => {
      window.removeEventListener("nerdgram:about", onAbout);
      window.removeEventListener("nerdgram:check-updates", onCheck);
    };
  }, [checkNow]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setPresenting(document.body.dataset.presenting === "true");
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-presenting"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!job?.running) return;
    const timer = window.setInterval(() => {
      void api
        .updateJob()
        .then((payload) => {
          setJob(payload.job);
          if (payload.job?.result?.version) {
            sessionStorage.setItem(TARGET_KEY, payload.job.result.version);
          }
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [job?.running]);

  const runSettings = async (body: { automatic?: boolean; includePrerelease?: boolean; clearSkipped?: boolean }) => {
    setBusy(true);
    setActionError(null);
    try {
      applyStatus(await api.updateSettings(body));
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    setBusy(true);
    try {
      applyStatus(await api.laterUpdate());
      setPanel(null);
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      applyStatus(await api.skipUpdate());
      setPanel(null);
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const openUpgrade = () => {
    if (status?.latest?.version) sessionStorage.setItem(TARGET_KEY, status.latest.version);
    if (status?.installKind === "docker" && status.docker) {
      setDockerGuide(status.docker);
      setPanel("docker");
      return;
    }
    setPanel("manual");
  };

  const startApply = async () => {
    setBusy(true);
    setActionError(null);
    setPanel("progress");
    try {
      const started = await api.applyUpdate();
      setJob(started.job);
      if (status?.latest?.version) sessionStorage.setItem(TARGET_KEY, status.latest.version);
    } catch (err) {
      setJob({
        running: false,
        phase: "failed",
        lines: [messageOf(err)],
        error: { code: err instanceof ApiError ? err.code ?? "update" : "update", message: messageOf(err) },
        result: null,
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
    } catch {
      setActionError("Could not copy. Select the command and copy it yourself.");
    }
  };

  const routePresenting =
    location.pathname.startsWith("/present") || location.pathname.startsWith("/templates/present");
  const showBanner = Boolean(
    status?.updateAvailable && !status.dismissed && !status.skipped && !presenting && !routePresenting,
  );

  const value = {
    status,
    job,
    busy,
    notice,
    panel,
    actionError,
    openAbout: () => setPanel("about"),
    closePanel: () => setPanel(null),
    checkNow,
    later,
    skip,
    clearSkipped: () => runSettings({ clearSkipped: true }),
    setAutomatic: (automatic: boolean) => runSettings({ automatic }),
    setPrerelease: (includePrerelease: boolean) => runSettings({ includePrerelease }),
    openNotes: () => setPanel("notes"),
    openUpgrade,
    startApply,
    reload: requestUpdateReload,
    dismissNotice: () => setNotice(null),
  };

  return (
    <UpdateContext.Provider value={value}>
      {children}
      {notice && !showBanner ? (
        <div className="update-banner update-banner-quiet" role="status">
          <p>{notice}</p>
          <button type="button" className="btn btn-ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {showBanner && status?.latest ? (
        <div className="update-banner" role="status">
          <p>
            NerdGram <strong>{status.latest.version}</strong> is available. This install is{" "}
            <strong>{status.currentVersion}</strong>.
          </p>
          <div className="update-banner-actions">
            <button type="button" className="btn" onClick={() => setPanel("notes")}>
              View release notes
            </button>
            {status.canApply ? (
              <button type="button" className="btn btn-primary" onClick={() => setPanel("progress")}>
                Update now
              </button>
            ) : null}
            {status.installKind === "docker" ? (
              <button type="button" className="btn btn-primary" onClick={openUpgrade}>
                Show upgrade steps
              </button>
            ) : null}
            {status.installKind === "zip" || status.installKind === "unknown" ? (
              <button type="button" className="btn" onClick={() => setPanel("manual")}>
                How to update
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => void later()}>
              Later
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void skip()}>
              Skip this version
            </button>
          </div>
        </div>
      ) : null}
      {panel === "about" ? (
        <Dialog title="About NerdGram1337" onClose={() => setPanel(null)}>
          <AboutBody />
        </Dialog>
      ) : null}
      {panel === "notes" && status?.latest ? (
        <Dialog title={`Release ${status.latest.version}`} onClose={() => setPanel(null)}>
          <p className="update-version-line">
            Running {status.currentVersion}
            {shortCommit(status.commit) ? ` (${shortCommit(status.commit)})` : ""}. Release{" "}
            {status.latest.version}.
          </p>
          <p>
            <a href={status.latest.htmlUrl} target="_blank" rel="noreferrer noopener">
              Open this release on GitHub
            </a>
          </p>
          <ReleaseMarkdown markdown={status.latest.body || "This release has no notes."} />
        </Dialog>
      ) : null}
      {panel === "docker" && dockerGuide && status ? (
        <Dialog title={`Upgrade to ${dockerGuide.tag}`} onClose={() => setPanel(null)}>
          <p className="update-version-line">
            This container is running {status.currentVersion}. The release is {dockerGuide.tag.replace(/^v/, "")}.
            NerdGram will not change the container from the inside.
          </p>
          {status.latest ? <ReleaseMarkdown markdown={status.latest.body || "This release has no notes."} /> : null}
          {status.latest ? (
            <p>
              <a href={status.latest.htmlUrl} target="_blank" rel="noreferrer noopener">
                Open this release on GitHub
              </a>
            </p>
          ) : null}
          <h4>docker run</h4>
          {dockerGuide.steps.map((step) => (
            <CommandBlock key={step.title} title={step.title} command={step.command} copied={copied} onCopy={copy} />
          ))}
          <h4>Docker Compose</h4>
          <p>{dockerGuide.composeNote}</p>
          {dockerGuide.compose.map((step) => (
            <CommandBlock key={step.title} title={step.title} command={step.command} copied={copied} onCopy={copy} />
          ))}
          <p className="update-persist">{dockerGuide.persistNote}</p>
          <div className="update-banner-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void checkNow({ keepPanel: true })}>
              Check again
            </button>
          </div>
          {actionError ? <p className="update-error">{actionError}</p> : null}
          {status.currentVersion === dockerGuide.tag.replace(/^v/, "") ? (
            <p role="status">This install is running {status.currentVersion}, which matches {dockerGuide.tag}.</p>
          ) : (
            <p role="status">
              This process is still running {status.currentVersion}. The release is {dockerGuide.tag.replace(/^v/, "")}.
              Recreate the container with the steps above, then check again.
            </p>
          )}
        </Dialog>
      ) : null}
      {panel === "manual" && status ? (
        <Dialog title="Update by hand" onClose={() => setPanel(null)}>
          <ManualCopy status={status} />
        </Dialog>
      ) : null}
      {panel === "progress" && status ? (
        <Dialog title={job?.result ? "Restart to finish" : "Update now"} onClose={() => setPanel(null)}>
          {!job ? (
            <>
              <p>
                Update to {status.latest?.version}? NerdGram will fetch that release, reinstall from the lockfiles,
                and rebuild. Your diagrams are not modified. The git tree has to be clean, on main or a detached
                release tag, and the release has to be a fast-forward. You will restart the app when it finishes.
              </p>
              <div className="update-banner-actions">
                <button type="button" className="btn btn-primary" disabled={busy || !status.canApply} onClick={() => void startApply()}>
                  Update now
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                {job.phase === "done" ? "The build finished." : job.running ? "Working…" : "Stopped."}
              </p>
              <ol className="update-log" aria-live="polite">
                {job.lines.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ol>
              {job.error ? <p className="update-error">{job.error.message}</p> : null}
              {job.result ? (
                <>
                  <p>{job.result.restart.instructions}</p>
                  <div className="update-banner-actions">
                    <button type="button" className="btn btn-primary" onClick={requestUpdateReload}>
                      Reload
                    </button>
                  </div>
                </>
              ) : null}
              {!job.running && !job.result ? (
                <div className="update-banner-actions">
                  <button type="button" className="btn" onClick={() => setJob(null)}>
                    Try again
                  </button>
                </div>
              ) : null}
            </>
          )}
        </Dialog>
      ) : null}
    </UpdateContext.Provider>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="update-dialog-title">{title}</h3>
        {children}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpdateSettingsFields() {
  const { status, busy, setAutomatic, setPrerelease, clearSkipped, checkNow } = useUpdate();
  if (!status) return <p>Loading update settings…</p>;
  const lockedOff = !status.enabled;
  return (
    <div>
      <p>
        Version {status.currentVersion}
        {status.commit ? ` · ${shortCommit(status.commit)}` : ""} · {installLabel(status.installKind)}
      </p>
      <label className="sync-check">
        <input
          type="checkbox"
          checked={status.automatic && status.enabled}
          disabled={busy || lockedOff}
          onChange={(event) => void setAutomatic(event.target.checked)}
        />
        <span>Check for updates automatically</span>
      </label>
      {lockedOff ? <p>NERDGRAM_UPDATE_CHECK=false turns checks off, including Check for updates.</p> : null}
      <label className="sync-check">
        <input
          type="checkbox"
          checked={status.includePrerelease}
          disabled={busy || lockedOff}
          onChange={(event) => void setPrerelease(event.target.checked)}
        />
        <span>Include prereleases</span>
      </label>
      {status.skippedVersions.length > 0 ? (
        <p>
          Skipped: {status.skippedVersions.join(", ")}{" "}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void clearSkipped()}>
            Reset skipped versions
          </button>
        </p>
      ) : null}
      <div className="update-banner-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void checkNow()}>
          Check for updates
        </button>
      </div>
    </div>
  );
}

function AboutBody() {
  const { status, actionError, busy, openUpgrade } = useUpdate();
  if (!status) return <p>{busy ? "Loading…" : "Version information is not available yet."}</p>;
  return (
    <>
      <p>
        <strong>NerdGram1337</strong> {status.currentVersion}
        {status.commit ? ` (${shortCommit(status.commit)})` : ""}
      </p>
      <p>Install: {installLabel(status.installKind)}</p>
      {status.installKind === "docker" ? (
        <>
          <p>
            This is a Docker install. NerdGram does not change the container from the inside. Pull a new image and
            start it again with the same /data volume. The steps use{" "}
            <code>ghcr.io/networknerd1337/nerdgram1337</code>, container <code>nerdgram1337</code>, volume{" "}
            <code>nerdgram-data</code>, and <code>127.0.0.1:8787:8787</code>.
          </p>
          {status.docker ? (
            <p>
              <button type="button" className="btn" disabled={busy} onClick={openUpgrade}>
                Show upgrade steps
              </button>
            </p>
          ) : null}
        </>
      ) : null}
      {status.phase === "ahead" ? <p>This build is newer than the latest stable release.</p> : null}
      {status.phase === "no_release" ? <p>No stable release has been published yet.</p> : null}
      {actionError ? <p className="update-error">{actionError}</p> : null}
      {status.error && !actionError ? <p className="update-error">{status.error.message}</p> : null}
      <UpdateSettingsFields />
    </>
  );
}

function ManualCopy({ status }: { status: UpdateStatus }) {
  const latest = status.latest;
  return (
    <>
      <p>
        This copy is {status.currentVersion}
        {latest ? `, and ${latest.version} is the latest release.` : "."} Update now is not available for a{" "}
        {status.installKind} install.
      </p>
      {status.installKind === "zip" ? (
        <p>
          Download the new ZIP from the release page, extract it, and run <code>npm run install:all</code> from that
          folder. Copy your <code>diagrams</code> folder into it, or keep <code>NERDGRAM_DATA_DIR</code> pointed at
          the same path.
        </p>
      ) : (
        <p>
          NerdGram could not tell how this copy was installed, so it will not change files. Download the release or
          switch to a git clone, and keep your diagrams folder or <code>NERDGRAM_DATA_DIR</code>.
        </p>
      )}
      {latest ? (
        <p>
          <a href={latest.htmlUrl} target="_blank" rel="noreferrer noopener">
            Open this release on GitHub
          </a>
        </p>
      ) : null}
      {latest?.body ? <ReleaseMarkdown markdown={latest.body} /> : null}
    </>
  );
}

function CommandBlock({
  title,
  command,
  copied,
  onCopy,
}: {
  title: string;
  command: string;
  copied: string | null;
  onCopy: (command: string) => Promise<void>;
}) {
  return (
    <div className="update-command">
      <div className="update-command-head">
        <span>{title}</span>
        <button type="button" className="btn" onClick={() => void onCopy(command)}>
          {copied === command ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{command}</code>
      </pre>
    </div>
  );
}

function installLabel(kind: UpdateStatus["installKind"]): string {
  if (kind === "git") return "git clone";
  if (kind === "docker") return "Docker";
  if (kind === "zip") return "ZIP download";
  return "unknown";
}
