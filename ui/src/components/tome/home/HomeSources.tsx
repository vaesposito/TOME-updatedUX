"use client";

import { ArrowUpRight, Clock, Database, RefreshCw } from "lucide-react";
import * as React from "react";

import { sourcesFromProject } from "@/components/tome/IngestPanel";
import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";
import type { ChildRow } from "@/components/tome/home/HomeChildren";
import { formatRelativeTimeCompact } from "@/lib/utils";

/**
 * Where this space's knowledge comes from.
 *
 * The inventory is built by the Ingest panel's own reader, so the two
 * surfaces always agree on what a source is called and which link reaches
 * it — including the several shapes Confluence has been stored in over time.
 * What Home adds is brevity: one line per provider, the items beneath it, and
 * no access checks, since asking every provider whether it still answers is
 * a page-load's worth of work and belongs on the panel that acts on it.
 *
 * Read on a BHAG or an Area the question is the same but the answer is not
 * the container's own: a goal connects almost nothing itself and reads
 * through the projects under it. Given those projects, the card answers at
 * that altitude — one line per provider across the whole subtree — rather
 * than reporting an empty container over a portfolio of connected ones.
 */

type SourceRow = ReturnType<typeof sourcesFromProject>[number];

/** Whether a space's sources have actually been read, and when they will be again. */
export interface SourceReading {
  /** The newest run, `null` where none has ever run, `undefined` while loading. */
  lastRun?: { at: string; status: string } | null;
  /** The schedule in plain words, or `null` where nothing is scheduled. */
  schedule?: string | null;
}

const SHOWN_PER_PROVIDER = 3;

/** Never throws: a source stored in an unexpected shape costs this card its
 *  contents, not the whole home page. */
function readSources(sources: Record<string, unknown> | null): SourceRow[] {
  if (!sources) return [];
  try {
    return sourcesFromProject(sources);
  } catch {
    return [];
  }
}

/**
 * Every provider across a set of spaces, each with its items gathered.
 *
 * Providers keep the order they were first seen in, which is the order the
 * reader of a single space already knows. Items are deduplicated by label,
 * because two projects mirroring the same repository is one source to read
 * and would otherwise be counted twice.
 */
function mergeSources(groups: readonly SourceRow[][]): SourceRow[] {
  const byKind = new Map<string, SourceRow>();
  const seen = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const row of group) {
      const found = byKind.get(row.kind);
      if (!found) {
        byKind.set(row.kind, { ...row, items: [...row.items] });
        seen.set(row.kind, new Set(row.items.map((item) => item.label)));
        continue;
      }
      const labels = seen.get(row.kind)!;
      for (const item of row.items) {
        if (labels.has(item.label)) continue;
        labels.add(item.label);
        found.items.push(item);
      }
    }
  }
  return [...byKind.values()];
}

export function HomeSources({
  sources,
  rollup,
  reading,
  ingestHref,
  onOpenIngest,
  actionLabel,
  container = false,
  loading = false,
}: {
  /** The space's own `sources`, in whatever shape it was stored. */
  sources: Record<string, unknown> | null;
  /**
   * The spaces below this one, when the card is read at a roll-up altitude.
   *
   * `undefined` on a project, which has nothing below it to roll up, and
   * `null` while the list is still on its way — the same distinction
   * `loading` draws for the space's own record.
   */
  rollup?: readonly ChildRow[] | null;
  /**
   * When this space last read its sources, and when it will read them next.
   *
   * A list of sources says where the knowledge could come from; this says
   * whether it has. Omitted where there is no single space to ask — the
   * roll-up answers the same question from the rows below instead.
   */
  reading?: SourceReading;
  ingestHref: string;
  onOpenIngest?: () => void;
  /**
   * What to call the way out, where "ingest" is not it.
   *
   * With no single space in view there is nothing to ingest from here, and
   * the way on is the list of spaces rather than a panel that acts.
   */
  actionLabel?: string;
  /** Whether this space holds other spaces, which changes only the wording. */
  container?: boolean;
  /**
   * Whether the page this reads is still on its way.
   *
   * Waiting and empty must not look alike: telling a reader nothing is connected, a moment
   * before a source arrives, is worse than telling them nothing
   * yet.
   */
  loading?: boolean;
}) {
  const own = React.useMemo(() => readSources(sources), [sources]);
  const below = React.useMemo(
    () => (rollup ?? []).map((child) => readSources(child.sources ?? null)),
    [rollup],
  );

  const rows = React.useMemo(
    () => mergeSources([own, ...below]),
    [own, below],
  );

  const total = rows.reduce((sum, row) => sum + row.items.length, 0);

  /** How many of the spaces in view actually read from anything. */
  const places =
    (own.length > 0 ? 1 : 0) + below.filter((group) => group.length > 0).length;

  /**
   * When the subtree was last read, which is the roll-up's answer to the
   * single space's "last ingest". Taken from the rows rather than counted
   * server-side: it is the newest of what is on screen, which is what the
   * sentence beneath them is about.
   */
  const lastIngest = (rollup ?? [])
    .map((child) => child.last_ingested_at)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1);

  const waitingOnChildren = rollup === null;

  return (
    <HomeCard
      title="Sources"
      icon={<Database className="h-4 w-4" />}
      count={total}
      action={homeAction(actionLabel ?? "Ingest", ingestHref, onOpenIngest)}
    >
      {loading || waitingOnChildren ? (
        <HomeSkeleton />
      ) : rows.length === 0 ? (
        <HomeEmpty
          icon={<Database />}
          headline="Nothing connected yet"
          hint={
            container
              ? "Nothing below this reads from a repository, a Confluence space or a Webex room yet."
              : "A repository, a Confluence space or a Webex room is what gives the agent something to read."
          }
          action={homeAction(
            actionLabel ??
              (container ? "Ingest & synthesize" : "Connect a source"),
            ingestHref,
            onOpenIngest,
          )}
        />
      ) : (
        <>
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li key={row.kind} className="min-w-0">
              <p className="flex items-baseline gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {row.label}
                <span className="tabular-nums normal-case">{row.items.length}</span>
              </p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {row.items.slice(0, SHOWN_PER_PROVIDER).map((item, index) => (
                  <li
                    key={item.sourceKey ?? item.room_id ?? `${item.label}:${index}`}
                    className="min-w-0"
                  >
                    {item.href ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="group flex min-w-0 items-center gap-1 text-xs text-foreground/80 transition-colors hover:text-foreground"
                      >
                        <span className="min-w-0 truncate">{item.label}</span>
                        <ArrowUpRight
                          className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                          aria-hidden="true"
                        />
                      </a>
                    ) : (
                      <span className="block min-w-0 truncate text-xs text-foreground/80">
                        {item.label}
                      </span>
                    )}
                  </li>
                ))}
                {row.items.length > SHOWN_PER_PROVIDER && (
                  <li className="text-[11px] text-muted-foreground">
                    and {row.items.length - SHOWN_PER_PROVIDER} more
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
        {/* Only where the list is a roll-up: on a single space every source
            is that space's, so saying where they come from would be noise. */}
        {rollup && rollup.length > 0 ? (
          <p className="mt-2 shrink-0 text-[11px] text-muted-foreground">
            From {places} {places === 1 ? "space" : "spaces"}
            {lastIngest ? `, last ingest ${formatRelativeTimeCompact(lastIngest)}` : ""}.
          </p>
        ) : null}
        {/* The single space's version of the same two facts, and the only
            place on this page that says whether the list above is current. */}
        {reading ? (
          <div className="mt-2.5 flex shrink-0 flex-col gap-1 border-t pt-2 text-[11px] text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {reading.lastRun === undefined
                  ? "Checking for a recent ingest…"
                  : reading.lastRun === null
                    ? "No ingest has run yet"
                    : `Last ingest ${formatRelativeTimeCompact(reading.lastRun.at)}, ${reading.lastRun.status.replace(/_/g, " ")}`}
              </span>
            </p>
            <p className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {reading.schedule ?? "Not scheduled"}
              </span>
            </p>
          </div>
        ) : null}
        </>
      )}
    </HomeCard>
  );
}
