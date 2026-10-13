"use client";

/**
 * What sits below a BHAG or an Area, and the state of each.
 *
 * The one card a container needs and a project does not. Everything else on
 * Home answers "what is happening here"; a BHAG's honest answer to that is
 * "in the eleven places underneath", and without this the reader has to open
 * each of them to find out which one is stuck.
 *
 * A row is deliberately not a summary of its child. It says only what would
 * make someone open it — whether anything is waiting, when it was last
 * touched, and whether the agent is reading it right now. Progress, health
 * and status belong to the child's own pages, written at the child's own
 * altitude, and rolling those up is how a portfolio view starts lying.
 */

import * as React from "react";
import Link from "next/link";
import { FolderTree, Loader2, Layers, FileText } from "lucide-react";

import { cn, formatRelativeTimeCompact } from "@/lib/utils";
import type { TomeSummaryEntity } from "@/types/tome-summary";

import { HomeCard, HomeEmpty, HomeSkeleton, homeAction } from "./HomeCard";

interface ChildRow {
  slug: string;
  title: string;
  type?: "project" | "bhag" | "area";
  parent_slug?: string;
  page_count: number;
  last_ingested_at: string | null;
  last_edited_at: string | null;
  ingesting: "queued" | "running" | null;
}

interface ChildrenResponse {
  children: ChildRow[];
  total: number;
  withheld: number;
}

/** The later of the two touches, which is what "last activity" means to a reader. */
function lastTouch(row: ChildRow, fromFeed?: string): string | null {
  const times = [row.last_ingested_at, row.last_edited_at, fromFeed ?? null];
  return times.filter(Boolean).sort().at(-1) ?? null;
}

export function HomeChildren({
  slug,
  kind,
  entities,
  settingsHref,
  className,
}: {
  slug: string;
  kind: "bhag" | "area";
  /** The digest's per-entity tallies, so a row can say what is waiting in it. */
  entities?: readonly TomeSummaryEntity[];
  settingsHref: string;
  className?: string;
}) {
  const [data, setData] = React.useState<ChildrenResponse | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    fetch(`/api/tome/projects/${encodeURIComponent(slug)}/children`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => {
        if (!cancelled) setData((body?.data ?? body) as ChildrenResponse);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, reload]);

  const tallies = React.useMemo(
    () => new Map((entities ?? []).map((entry) => [entry.slug, entry] as const)),
    [entities],
  );

  const rows = data?.children ?? [];
  const waiting = rows.reduce(
    (sum, row) => sum + (tallies.get(row.slug)?.attention ?? 0),
    0,
  );

  return (
    <HomeCard
      icon={<FolderTree />}
      title={kind === "bhag" ? "Areas & projects" : "Projects"}
      {...(data && data.total > 0 ? { count: data.total } : {})}
      className={className}
    >
      {!data && !failed ? <HomeSkeleton rows={4} /> : null}

      {failed ? (
        <HomeEmpty
          icon={<Layers />}
          headline="Could not load what's below"
          hint="The list of areas and projects under this space could not be read just now."
          action={homeAction("Try again", "", () => setReload((n) => n + 1))}
        />
      ) : null}

      {data && rows.length === 0 ? (
        <HomeEmpty
          icon={<Layers />}
          headline="Nothing below this yet"
          hint={
            kind === "bhag"
              ? "Areas and projects name this space as the one they belong to, and appear here once they do."
              : "Projects name this area as the one they belong to, and appear here once they do."
          }
          action={homeAction("Open settings", settingsHref)}
        />
      ) : null}

      {rows.length > 0 ? (
        <>
          {waiting > 0 ? (
            <p className="mb-2 text-[11px] text-muted-foreground">
              {waiting === 1 ? "1 thing is" : `${waiting} things are`} waiting
              across{" "}
              {rows.filter((row) => (tallies.get(row.slug)?.attention ?? 0) > 0)
                .length}{" "}
              of {data?.total ?? rows.length}.
            </p>
          ) : null}
          <ul className="min-w-0 space-y-px">
            {rows.map((row) => (
              <ChildLine
                key={row.slug}
                row={row}
                tally={tallies.get(row.slug)}
                nested={Boolean(row.parent_slug)}
              />
            ))}
          </ul>
          {data && (data.total > rows.length || data.withheld > 0) ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Showing {rows.length} of {data.total}
              {data.withheld > 0
                ? `, and ${data.withheld} not shared with you`
                : ""}
              .
            </p>
          ) : null}
        </>
      ) : null}
    </HomeCard>
  );
}

/**
 * One child.
 *
 * Indented when it hangs off an Area rather than off the BHAG directly, which
 * is the only way a reader can tell a two-tier portfolio from a flat one.
 */
function ChildLine({
  row,
  tally,
  nested,
}: {
  row: ChildRow;
  tally?: TomeSummaryEntity;
  nested: boolean;
}) {
  const attention = tally?.attention ?? 0;
  const touched = lastTouch(row, tally?.latest_at);

  return (
    <li>
      <Link
        href={`/projects/${row.slug}/tome`}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted/60",
          nested && "ml-4",
        )}
      >
        {row.type === "area" ? (
          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        {/* An Area is a heading for the rows under it, not a peer of them. */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-foreground",
            row.type === "area" ? "font-semibold" : "font-medium",
          )}
        >
          {row.title}
        </span>

        {attention > 0 ? (
          <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-destructive">
            {attention} waiting
          </span>
        ) : null}

        {row.ingesting ? (
          <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-primary">
            <Loader2
              className={cn(
                "h-3 w-3",
                row.ingesting === "running" && "animate-spin",
              )}
            />
            {row.ingesting === "running" ? "Ingesting" : "Queued"}
          </span>
        ) : null}

        <span className="hidden shrink-0 tabular-nums text-muted-foreground sm:inline">
          {row.page_count === 1 ? "1 page" : `${row.page_count} pages`}
        </span>
        <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
          {touched ? formatRelativeTimeCompact(touched) : "—"}
        </span>
      </Link>
    </li>
  );
}
