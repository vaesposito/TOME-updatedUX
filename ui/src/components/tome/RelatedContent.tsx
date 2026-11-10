"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { RelatedContentRow } from "@/hooks/use-related-content";
import { describeSpaceTag } from "@/lib/tome/space-tags";
import { wikiPageHref } from "@/lib/tome/wiki-page-href";

/**
 * Pages elsewhere that tag this space.
 *
 * The two trees are disjoint, so nothing about the hierarchy makes two spaces
 * related — a page claiming this space is the only connection there is. Every
 * row therefore names the space the page lives in: the reader is being sent
 * somewhere else to read it, and a bare page title would not say where.
 */

function label(row: RelatedContentRow): string {
  return describeSpaceTag({ page: row.wholePage, passages: row.passages });
}

/** The rail's rendering: page names under the section, at the tree's measure. */
export function RelatedContentRail({
  related,
  bare,
}: {
  related: RelatedContentRow[];
  /**
   * Drop the heading.
   *
   * Set where the section above already says what these are; a second
   * heading under its own row would name the same thing twice.
   */
  bare?: boolean;
}) {
  if (related.length === 0) return null;

  return (
    <div className="mb-2">
      {!bare && (
        <p className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Related content
        </p>
      )}
      <ul>
        {related.map((row) => (
          <li key={`${row.spaceSlug}:${row.path}`}>
            <Link
              href={wikiPageHref(row.spaceSlug, row.path)}
              title={`${row.title} — in ${row.spaceTitle} · ${label(row)}`}
              className="flex items-center gap-1 rounded py-1 pl-1.5 pr-1.5 text-sm transition-colors hover:bg-muted"
            >
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
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

/** The page's rendering: the same pages, with the space each one lives in. */
export function RelatedContentBlock({
  related,
  bare,
}: {
  related: RelatedContentRow[];
  /** Drop the heading, where the page's own already says this. */
  bare?: boolean;
}) {
  if (related.length === 0) return null;

  return (
    <section className="pb-2">
      {!bare && (
        <h3 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Related content
        </h3>
      )}
      <div className="divide-y">
        {related.map((row) => (
          <Link
            key={`${row.spaceSlug}:${row.path}`}
            href={wikiPageHref(row.spaceSlug, row.path)}
            className="flex w-full items-center gap-3 px-2 py-4 text-left transition-colors hover:bg-muted/60"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{row.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {row.spaceTitle} · {label(row)}
              </span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </section>
  );
}
