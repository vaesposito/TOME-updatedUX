"use client";

import { ArrowUpRight, Database } from "lucide-react";
import * as React from "react";

import { sourcesFromProject } from "@/components/tome/IngestPanel";
import {
  HomeCard,
  HomeEmpty,
  homeAction,
} from "@/components/tome/home/HomeCard";

/**
 * Where this project's knowledge comes from.
 *
 * The inventory is built by the Ingest panel's own reader, so the two
 * surfaces always agree on what a source is called and which link reaches
 * it — including the several shapes Confluence has been stored in over time.
 * What Home adds is brevity: one line per provider, the items beneath it, and
 * no access checks, since asking every provider whether it still answers is
 * a page-load's worth of work and belongs on the panel that acts on it.
 */

type SourceRow = ReturnType<typeof sourcesFromProject>[number];

const SHOWN_PER_PROVIDER = 3;

export function HomeSources({
  sources,
  ingestHref,
  onOpenIngest,
}: {
  /** The project's `sources`, in whatever shape it was stored. */
  sources: Record<string, unknown> | null;
  ingestHref: string;
  onOpenIngest?: () => void;
}) {
  const rows: SourceRow[] = React.useMemo(() => {
    if (!sources) return [];
    try {
      return sourcesFromProject(sources);
    } catch {
      // A source saved in a shape the reader does not expect should cost the
      // card its contents, not take the whole home page down with it.
      return [];
    }
  }, [sources]);

  const total = rows.reduce((sum, row) => sum + row.items.length, 0);

  return (
    <HomeCard
      title="Sources"
      icon={<Database className="h-4 w-4" />}
      count={total}
      action={homeAction("Ingest", ingestHref, onOpenIngest)}
    >
      {rows.length === 0 ? (
        <HomeEmpty
          icon={<Database />}
          headline="Nothing connected yet"
          hint="A repository, a Confluence space or a Webex room is what gives the agent something to read."
          action={homeAction("Connect a source", ingestHref, onOpenIngest)}
        />
      ) : (
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
      )}
    </HomeCard>
  );
}
