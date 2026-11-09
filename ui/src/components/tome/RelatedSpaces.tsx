"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { RelatedSpaceRow } from "@/hooks/use-related-spaces";

/**
 * The spaces tagged into the same category as this one.
 *
 * Shown inside Connections, above the sources, because they answer the same
 * question from two directions: what is this space attached to that is not
 * in it? A repository it mirrors is one answer and a sibling space running
 * the other half of the same programme is another.
 *
 * The category is named on every row. Two spaces being related is only
 * meaningful through the thing that relates them, and a bare list would make
 * the reader guess at it.
 */

function href(slug: string): string {
  return `/projects/${encodeURIComponent(slug)}/tome`;
}

/** The rail's rendering: names under the section, at the tree's own measure. */
export function RelatedSpacesRail({ related }: { related: RelatedSpaceRow[] }) {
  if (related.length === 0) return null;

  return (
    <div className="mb-2">
      <p className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Tagged alongside
      </p>
      <ul>
        {related.map((space) => (
          <li key={space.slug}>
            <Link
              href={href(space.slug)}
              title={`${space.title} — ${space.through.join(", ")}`}
              className="flex items-center gap-1 rounded py-1 pl-1.5 pr-1.5 text-sm transition-colors hover:bg-muted"
            >
              <span className="min-w-0 flex-1 truncate">{space.title}</span>
              <ArrowUpRight
                className="h-3 w-3 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The page's rendering: the same spaces, with the category that ties them. */
export function RelatedSpacesBlock({ related }: { related: RelatedSpaceRow[] }) {
  if (related.length === 0) return null;

  return (
    <section className="pb-2">
      <h3 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Tagged alongside
      </h3>
      <div className="divide-y">
        {related.map((space) => (
          <Link
            key={space.slug}
            href={href(space.slug)}
            className="flex w-full items-center gap-3 px-2 py-4 text-left transition-colors hover:bg-muted/60"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{space.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {space.through.join(" · ")}
              </span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </section>
  );
}
