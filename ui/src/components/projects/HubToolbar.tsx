"use client";

import { Search, X } from "lucide-react";

/**
 * The row every reading of the catalogue is headed by: what is being shown
 * on one side, and what narrows it or adds to it on the other.
 *
 * One component rather than one per view. The projects, the functions and a
 * single category are three readings of the same set of projects, and a
 * toolbar that moved by a few pixels between them would read as three
 * different screens rather than one looked at three ways.
 */
export function HubToolbar({
  heading,
  children,
}: {
  /** The count, and anything that belongs beside it. */
  heading: React.ReactNode;
  /** The controls, in the order they should be read. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">{heading}</div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        {children}
      </div>
    </div>
  );
}

/** What a view is showing, counted. */
export function HubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="whitespace-nowrap text-xl font-semibold">{children}</h2>
  );
}

/**
 * The one field every reading of the catalogue is narrowed by.
 *
 * Its own clearing control, because a search typed into a view that still
 * holds the query after the reader has moved on is a view they cannot get
 * back without selecting the text themselves.
 */
export function HubSearchField({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Said to assistive technology, which has no placeholder to read. */
  label: string;
  clearLabel: string;
}) {
  return (
    <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-8 w-full rounded-lg border border-border/60 bg-background/40 pl-8 pr-8 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 hover:border-border focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={clearLabel}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
