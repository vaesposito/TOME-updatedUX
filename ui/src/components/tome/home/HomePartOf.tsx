"use client";

import {
  Building2,
  ChevronRight,
  FolderTree,
  Layers,
  Network,
  Target,
} from "lucide-react";
import Link from "next/link";

import type { AncestorRow } from "@/lib/tome/space-trail";

// Re-exported where the card used to own it, for the surfaces that read the
// row type from here.
export type { AncestorRow };
import * as React from "react";
import type { ReactNode } from "react";

import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";

/**
 * What this space belongs to.
 *
 * Every other card on Home looks down or sideways — what is below, what has
 * happened, who is on it. This is the one that looks up, and without it a
 * reader who arrived at a project from a search has no way to learn that it
 * is one of eleven under a goal without going back out to the hub.
 *
 * The trail is the breadcrumb's, as data: one path, nearest ancestor last, so
 * the card and the crumb at the top of the page can never disagree about
 * where a space sits. A BHAG has nothing above it and does not carry this
 * card at all — the arrangement leaves it out rather than this answering with
 * an empty one.
 */

/** What each level of each axis is called and coloured as. */
const LEVELS: Record<AncestorRow["type"], { label: string; icon: ReactNode }> = {
  bhag: { label: "Goal", icon: <Target className="h-3.5 w-3.5 shrink-0 text-primary" /> },
  area: { label: "Area", icon: <Layers className="h-3.5 w-3.5 shrink-0 text-sky-500" /> },
  function: {
    label: "Function",
    icon: <Building2 className="h-3.5 w-3.5 shrink-0 text-violet-500" />,
  },
  category: {
    label: "Category",
    icon: <FolderTree className="h-3.5 w-3.5 shrink-0 text-violet-500" />,
  },
};

export function HomePartOf({
  ancestors,
  settingsHref,
  onOpenSettings,
  loading = false,
}: {
  /** Furthest ancestor first, as the breadcrumb reads it. */
  ancestors: readonly AncestorRow[];
  /** Where the goal and area a space belongs to are set. */
  settingsHref: string;
  onOpenSettings?: () => void;
  /**
   * Whether the tags this is read from are still on their way.
   *
   * Waiting and empty must not look alike: telling a reader a project belongs
   * to nothing, a moment before naming its goal, is worse than telling them
   * nothing yet.
   */
  loading?: boolean;
}) {
  return (
    <HomeCard
      title="Part of"
      icon={<Network className="h-4 w-4" />}
      action={homeAction("Settings", settingsHref, onOpenSettings)}
    >
      {loading ? (
        <HomeSkeleton rows={2} />
      ) : ancestors.length === 0 ? (
        <HomeEmpty
          icon={<Network />}
          headline="Not part of anything yet"
          hint="Naming the goal or the area this belongs to puts it here, and lets a reader walk up from this space to the rest of the work around it."
          action={homeAction("Open settings", settingsHref, onOpenSettings)}
        />
      ) : (
        /* A row, because a trail is a path: the goal, then the area within
           it, read left to right as the crumb at the top of the page reads
           them. Wraps rather than truncates on a narrow window, where the
           names matter more than the one line. */
        <ul className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5">
          {ancestors.map((ancestor, index) => (
            <li key={ancestor.href} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              <Link
                href={ancestor.href}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted/60"
              >
                {/* Coloured as the breadcrumb colours them, so the two
                    readings of the same trail look like one thing. */}
                {LEVELS[ancestor.type].icon}
                <span className="min-w-0 truncate font-medium text-foreground">
                  {ancestor.title}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {LEVELS[ancestor.type].label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}
