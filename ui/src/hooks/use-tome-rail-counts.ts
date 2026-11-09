"use client";

import { useEffect, useState } from "react";

/** What was read, and for which space, so one space's figures cannot stand for another's. */
type RailCounts = {
  slug: string;
  notes?: number;
  issues?: number;
  meetings?: number;
};

/**
 * How much sits behind the rail's Notes, Issues and Meetings rows.
 *
 * The rail reports how much is under every row that holds a list, so a reader
 * learns whether a place is worth opening without opening it. The wiki's own
 * payload already carries the page tree those counts come from; these three
 * live behind their own endpoints, so the rail reads them itself.
 *
 * Read once per space, and Issues only when that row is on the rail at all —
 * it reaches GitHub, which is the one count here worth not asking for.
 */
export function useTomeRailCounts(
  slug: string,
  { issues }: { issues: boolean },
): { notes?: number; issues?: number; meetings?: number } {
  const [counts, setCounts] = useState<RailCounts>({ slug });

  useEffect(() => {
    let cancelled = false;

    const read = async (
      path: string,
      key: string,
      field: "notes" | "issues" | "meetings",
    ) => {
      try {
        const response = await fetch(
          `/api/tome/projects/${encodeURIComponent(slug)}/${path}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const body = await response.json();
        const rows = (body?.data ?? body)?.[key];
        if (cancelled || !Array.isArray(rows)) return;
        // A figure read for one space never joins another's record: the first
        // read after a move starts the record over.
        setCounts((prev) =>
          prev.slug === slug
            ? { ...prev, [field]: rows.length }
            : { slug, [field]: rows.length },
        );
      } catch {
        // A count the rail could not read is a count it does not show, which
        // is what it shows while loading anyway. The row still goes
        // somewhere, and that somewhere reports its own failures.
      }
    };

    void read("gists", "gists", "notes");
    // The series a space listens to, not the calls held under them: the row
    // leads to the list of series, and a count should count what it opens.
    void read("webex-meeting-series", "subscriptions", "meetings");
    if (issues) void read("github-issues", "issues", "issues");

    return () => {
      cancelled = true;
    };
  }, [slug, issues]);

  // Derived rather than cleared on the way in: until a read for this space
  // lands, there is no count to show, and the one held is the last space's.
  return counts.slug === slug
    ? { notes: counts.notes, issues: counts.issues, meetings: counts.meetings }
    : {};
}
