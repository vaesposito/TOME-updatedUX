"use client";

import { BookOpen } from "lucide-react";

import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";

/**
 * What this space is, in the words whoever set it up chose.
 *
 * The description used to sit under the title on every view, clipped to one
 * line with the rest of it behind a hover. A sentence somebody wrote to
 * explain their work is not a tooltip, and a reader who has to hover to
 * finish reading it mostly does not. So it lives here instead, where there
 * is room for all of it and where a reader arriving at the space is already
 * looking.
 */
export function HomeAbout({
  description,
  settingsHref,
  onOpenSettings,
  loading = false,
}: {
  /** The space's own description, or null where it has none. */
  description: string | null;
  /** Where the description is written. */
  settingsHref: string;
  onOpenSettings?: () => void;
  /**
   * Whether the record this reads is still on its way.
   *
   * Waiting and empty must not look alike: telling a reader the space has
   * never been described, a moment before describing it, is worse than
   * telling them nothing yet.
   */
  loading?: boolean;
}) {
  const text = description?.trim() ?? "";

  return (
    <HomeCard
      title="About"
      icon={<BookOpen className="h-4 w-4" />}
      action={homeAction("Settings", settingsHref, onOpenSettings)}
    >
      {loading ? (
        <HomeSkeleton rows={2} />
      ) : !text ? (
        <HomeEmpty
          icon={<BookOpen />}
          headline="Not described yet"
          hint="A sentence or two on what this space is for is the first thing a reader arriving from a search needs."
          action={homeAction("Open settings", settingsHref, onOpenSettings)}
        />
      ) : (
        /* Whole, wrapped and unclipped: the point of moving it here was that
           all of it should be readable without hovering anything. */
        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
          {text}
        </p>
      )}
    </HomeCard>
  );
}
