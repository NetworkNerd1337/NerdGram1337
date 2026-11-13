import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  collectCommands,
  EMPTY_COMMAND_HOST,
  formatShortcut,
  isPaletteShortcut,
  type CommandContext,
  type CommandHostInput,
  type PaletteCommand,
} from "../lib/commands";
import { searchDiagrams } from "../lib/diagramSearch";
import type { DiagramSearchHit } from "../types";
import "../lib/builtinCommands";
import "../lib/presentCommands";
import { HighlightedText } from "./HighlightedText";
import { PaletteContext, usePaletteControls, type PaletteControls } from "./commandPaletteContext";

const NO_HITS: DiagramSearchHit[] = [];

function shortcutMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function CommandsButton() {
  const { openPalette } = usePaletteControls();
  const label = shortcutMac() ? "⌘K" : "Ctrl+K";
  return (
    <button
      type="button"
      className="btn btn-ghost commands-button"
      onClick={openPalette}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
    >
      Commands
      <span className="kbd" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

export function CommandPaletteRoot({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const hostRef = useRef<CommandHostInput>(EMPTY_COMMAND_HOST);
  const [open, setOpen] = useState(false);
  const openPalette = useMemo(() => () => setOpen(true), []);
  const setHost = useMemo(() => {
    return (input: CommandHostInput) => {
      hostRef.current = input;
    };
  }, []);
  const controls = useMemo<PaletteControls>(() => ({ setHost, openPalette }), [openPalette, setHost]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      if (document.body.dataset.presenting === "true") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <PaletteContext.Provider value={controls}>
      {children}
      {open ? (
        <CommandPaletteDialog
          buildContext={(query) => ({ ...hostRef.current, query, navigate })}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </PaletteContext.Provider>
  );
}

function CommandPaletteDialog({
  buildContext,
  onClose,
}: {
  buildContext: (query: string) => CommandContext;
  onClose: () => void;
}) {
  const titleId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<DiagramSearchHit[]>([]);
  const [hitQuery, setHitQuery] = useState("");
  const mac = shortcutMac();
  const trimmedQuery = query.trim();
  const diagramHits = trimmedQuery && hitQuery === trimmedQuery ? hits : NO_HITS;
  const results = useMemo(
    () => collectCommands({ ...buildContext(query), diagramHits }),
    [buildContext, query, diagramHits],
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchDiagrams(q, { signal: controller.signal }).then(
        (result) => {
          if (controller.signal.aborted) return;
          setHits(result.hits);
          setHitQuery(q);
        },
        () => {
          if (controller.signal.aborted) return;
          setHits([]);
          setHitQuery(q);
        },
      );
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);
  const activeIndex = results.length === 0 ? 0 : Math.min(active, results.length - 1);
  const activeId = results[activeIndex] ? `${listId}-option-${activeIndex}` : undefined;

  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      restoreFocus.current?.focus();
    };
  }, []);

  useEffect(() => {
    const node = document.getElementById(activeId ?? "");
    node?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const run = (command: PaletteCommand | undefined) => {
    if (!command) return;
    const ctx = buildContext(query);
    onClose();
    queueMicrotask(() => {
      void command.run(ctx);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(results.length - 1, current + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, results.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      run(results[activeIndex]);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">
          Command palette
        </h2>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search commands"
          placeholder="Search commands and diagrams"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
        <div className="sr-only" aria-live="polite">
          {results.length === 0
            ? "No matching commands"
            : `${results.length} command${results.length === 1 ? "" : "s"}`}
        </div>
        <ul id={listId} role="listbox" aria-label="Commands">
          {results.length === 0 ? (
            <li className="palette-empty">No matching commands</li>
          ) : (
            results.map((command, index) => (
              <li key={command.id} role="presentation">
                <button
                  type="button"
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? "active" : ""}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <span>
                    <span className="palette-title">{command.title}</span>
                    {command.section ? <span className="palette-section">{command.section}</span> : null}
                    {command.detail ? (
                      <span className="palette-detail">
                        <HighlightedText
                          text={command.detail}
                          start={command.matchStart ?? 0}
                          length={command.matchLength ?? 0}
                        />
                      </span>
                    ) : null}
                  </span>
                  {command.shortcut ? (
                    <span className="kbd">{formatShortcut(command.shortcut, mac)}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
