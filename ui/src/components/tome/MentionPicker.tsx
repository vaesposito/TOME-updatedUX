"use client";

import { CornerDownLeft, Search } from "lucide-react";
import * as React from "react";

import type { MentionQuery } from "@/components/tome/CrepeEditor";
import { PAGE_NOTIFY_NOTE_MAX, type PageNotifyRecipient } from "@/types/tome";

/** The directory search endpoint rejects anything shorter. */
const MIN_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 200;
const PANEL_WIDTH = 288;
const PANEL_GAP = 6;

interface DirectoryResult {
  email: string;
  name?: string;
  subject?: string;
}

function unwrapResults(value: unknown): DirectoryResult[] {
  const body = value as { data?: DirectoryResult[] } | DirectoryResult[] | null;
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.data) ? body.data : [];
}

/**
 * Keep the panel on screen when the `@` is typed near an edge, where
 * anchoring to it directly would push half the list out of view.
 */
function anchorStyle(anchor: MentionQuery): React.CSSProperties {
  const maxLeft = Math.max(8, window.innerWidth - PANEL_WIDTH - 8);
  return {
    left: Math.min(anchor.left, maxLeft),
    top: anchor.bottom + PANEL_GAP,
    width: PANEL_WIDTH,
  };
}

/**
 * People picker that follows an `@` typed into the page body.
 *
 * The editor keeps focus while the list is up — the `@…` in the document *is*
 * the search box — so arrow keys and Enter are intercepted on the way down
 * rather than handled by a focused listbox. Choosing someone moves focus here
 * for the optional message, which is safe because ProseMirror holds its
 * selection through a blur and so the mention still lands where it was typed.
 */
export function MentionPicker({
  query,
  onCancel,
  onPick,
}: {
  /** The live `@…` from the editor, or null once it has ended. */
  query: MentionQuery | null;
  onCancel: () => void;
  onPick: (person: PageNotifyRecipient, note: string | undefined) => void;
}) {
  const [anchor, setAnchor] = React.useState<MentionQuery | null>(null);
  const [results, setResults] = React.useState<DirectoryResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [chosen, setChosen] = React.useState<DirectoryResult | null>(null);
  const [note, setNote] = React.useState("");
  const noteRef = React.useRef<HTMLInputElement>(null);

  // The anchor is latched rather than read straight from the prop: once
  // someone is chosen, focus leaves the editor and the live query goes away,
  // but the panel has to stay put while the message is typed.
  React.useEffect(() => {
    if (query) setAnchor(query);
    else if (!chosen) setAnchor(null);
  }, [query, chosen]);

  const term = (chosen ? "" : (query?.query ?? "")).trim();

  React.useEffect(() => {
    if (term.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(term)}`);
        if (!response.ok) throw new Error(`directory search ${response.status}`);
        const found = unwrapResults(await response.json());
        if (!cancelled) {
          setResults(found);
          setActive(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const dismiss = React.useCallback(() => {
    setChosen(null);
    setNote("");
    setAnchor(null);
    onCancel();
  }, [onCancel]);

  const commit = React.useCallback(
    (person: DirectoryResult, message: string) => {
      const trimmed = message.trim();
      onPick(
        { email: person.email, name: person.name, subject: person.subject },
        trimmed || undefined,
      );
      setChosen(null);
      setNote("");
      setAnchor(null);
    },
    [onPick],
  );

  const listing = anchor !== null && chosen === null;

  // Captured at the document, because the keys being stolen are ones the
  // editor would otherwise act on while it still holds focus.
  React.useEffect(() => {
    if (!listing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      }
      if (results.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === "ArrowDown" ? 1 : results.length - 1;
        setActive((current) => (current + step) % results.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        setChosen(results[active]);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [listing, results, active, dismiss]);

  React.useEffect(() => {
    if (chosen) noteRef.current?.focus();
  }, [chosen]);

  if (!anchor) return null;

  const person = chosen;
  const style = anchorStyle(anchor);

  return (
    <div
      role="dialog"
      aria-label="Tag someone on this page"
      style={style}
      className="fixed z-50 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
    >
      {person ? (
        <div className="p-3">
          <p className="pb-2 text-xs text-muted-foreground">
            Tagging{" "}
            <span className="font-medium text-foreground">
              {person.name || person.email}
            </span>
          </p>
          <input
            ref={noteRef}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(person, note);
              } else if (event.key === "Escape") {
                event.preventDefault();
                dismiss();
              }
            }}
            maxLength={PAGE_NOTIFY_NOTE_MAX}
            placeholder="Add a message (optional)…"
            aria-label={`Message for ${person.name || person.email}`}
            className="w-full rounded-md border border-muted-foreground bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] text-muted-foreground">
              Sent only to them, when you save.
            </p>
            <button
              type="button"
              onClick={() => commit(person, note)}
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
            >
              Tag
              <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div className="py-1">
          <div className="flex items-center gap-2 px-3 pb-1 pt-1 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
            <span className="truncate">
              {term.length < MIN_QUERY ? "Keep typing a name…" : `@${term}`}
            </span>
          </div>
          {term.length >= MIN_QUERY &&
            (loading ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No matches.</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto">
                {results.map((result, index) => (
                  <li key={result.email}>
                    <button
                      type="button"
                      // The editor keeps focus, so a press has to be caught
                      // before the browser moves it and collapses the caret.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setChosen(result);
                      }}
                      onMouseEnter={() => setActive(index)}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${
                        index === active ? "bg-muted" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{result.name || result.email}</span>
                        {result.name && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {result.email}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}
    </div>
  );
}
