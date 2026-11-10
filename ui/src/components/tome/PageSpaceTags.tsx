"use client";

import Link from "next/link";
import { Hash, Link2, X } from "lucide-react";
import * as React from "react";

import type { TaggableSpace } from "@/components/tome/SpaceTagPicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { spaceTagHref } from "@/lib/tome/space-tags";

/**
 * Which spaces this whole page is connected to.
 *
 * The easy granularity, and the durable one: a whole-page tag is frontmatter,
 * so it is independent of the prose and is the only form the server can carry
 * across an ingest that regenerates the body. Tagging a single passage is the
 * other half, and happens inline in the editor with `#`.
 *
 * Shown while reading as well as while editing — which spaces a page claims to
 * belong to is a fact about the page, not a setting only its editor needs.
 */
export function PageSpaceTags({
  tags,
  spaces,
  editing,
  disabled,
  onChange,
}: {
  /** Slugs currently tagged on this page. */
  tags: readonly string[];
  /** Every space that could be tagged, for naming a slug and for the picker. */
  spaces: readonly TaggableSpace[];
  editing: boolean;
  disabled?: boolean;
  onChange: (slugs: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");

  const titleOf = React.useCallback(
    (slug: string) => spaces.find((space) => space.slug === slug)?.title ?? slug,
    [spaces],
  );

  const choices = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    return spaces
      .filter((space) => !tags.includes(space.slug))
      .filter(
        (space) =>
          !needle ||
          space.title.toLowerCase().includes(needle) ||
          space.slug.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [spaces, tags, term]);

  if (tags.length === 0 && !editing) return null;

  return (
    <span
      className="flex flex-wrap items-center gap-1"
      data-testid="tome-page-space-tags"
      data-tour="page-tags"
    >
      {tags.map((slug) =>
        editing ? (
          <span
            key={slug}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            <Hash className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            <span className="max-w-32 truncate">{titleOf(slug)}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(tags.filter((kept) => kept !== slug))}
              aria-label={`Disconnect this page from ${titleOf(slug)}`}
              className="rounded-full p-0.5 hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="h-2.5 w-2.5" aria-hidden="true" />
            </button>
          </span>
        ) : (
          <Link
            key={slug}
            href={spaceTagHref(slug)}
            title={`Connected to ${titleOf(slug)} — this page shows in its related content`}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Hash className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            <span className="max-w-32 truncate">{titleOf(slug)}</span>
          </Link>
        ),
      )}

      {editing && (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setTerm("");
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Link2 className="h-2.5 w-2.5" aria-hidden="true" />
              Connect to a space
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
            <p className="px-1 pb-2 text-xs text-muted-foreground">
              This page will show in the space&apos;s related content, and its
              agent can read it.
            </p>
            <input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search spaces…"
              aria-label="Search spaces to connect this page to"
              className="mb-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            {choices.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">No space matches.</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto">
                {choices.map((space) => (
                  <li key={space.slug}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange([...tags, space.slug]);
                        setTerm("");
                        setOpen(false);
                      }}
                      className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
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
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
