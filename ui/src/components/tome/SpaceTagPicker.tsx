"use client";

import { Hash } from "lucide-react";
import * as React from "react";

import type { MentionQuery } from "@/components/tome/CrepeEditor";

const PANEL_WIDTH = 288;
const PANEL_GAP = 6;

/** A space the reader may tag content with. */
export interface TaggableSpace {
  slug: string;
  title: string;
  /** Which tree it sits on, shown so two similarly named spaces can be told apart. */
  kind?: string;
}

/**
 * Keep the panel on screen when the `#` is typed near an edge, where
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

function matches(space: TaggableSpace, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  return (
    space.title.toLowerCase().includes(needle) ||
    space.slug.toLowerCase().includes(needle)
  );
}

/**
 * Space picker that follows a `#` typed into the page body.
 *
 * A picker rather than free text, so a tag always names a space that exists:
 * a tag pointing at nothing would index against a slug no reader could ever
 * stand in, and would be invisible rather than wrong.
 *
 * Keyboard handling mirrors the people picker: the editor keeps focus and the
 * `#…` in the document *is* the search box, so arrow keys and Enter are
 * intercepted on the way down rather than handled by a focused listbox.
 */
export function SpaceTagPicker({
  spaces,
  query,
  onCancel,
  onPick,
}: {
  /** Every space this reader may tag with, on either axis. */
  spaces: TaggableSpace[];
  /** The live `#…` from the editor, or null once it has ended. */
  query: MentionQuery | null;
  onCancel: () => void;
  onPick: (space: TaggableSpace) => void;
}) {
  const [active, setActive] = React.useState(0);
  const term = (query?.query ?? "").trim();

  const results = React.useMemo(
    () => spaces.filter((space) => matches(space, term)).slice(0, 8),
    [spaces, term],
  );

  React.useEffect(() => {
    setActive(0);
  }, [term]);

  // Captured at the document, because the keys being stolen are ones the
  // editor would otherwise act on while it still holds focus.
  React.useEffect(() => {
    if (!query) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
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
        onPick(results[active]);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [query, results, active, onCancel, onPick]);

  if (!query) return null;

  return (
    <div
      role="dialog"
      aria-label="Tag this content with a space"
      style={anchorStyle(query)}
      className="fixed z-50 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
      data-testid="tome-space-tag-picker"
    >
      <div className="py-1">
        <div className="flex items-center gap-2 px-3 pb-1 pt-1 text-xs text-muted-foreground">
          <Hash className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
          <span className="truncate">{term ? `#${term}` : "Tag a space…"}</span>
        </div>
        {results.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No space matches.</p>
        ) : (
          <ul className="max-h-56 overflow-y-auto">
            {results.map((space, index) => (
              <li key={space.slug}>
                <button
                  type="button"
                  // The editor keeps focus, so a press has to be caught
                  // before the browser moves it and collapses the caret.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPick(space);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${
                    index === active ? "bg-muted" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{space.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {space.kind ? `${space.kind} · ${space.slug}` : space.slug}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
