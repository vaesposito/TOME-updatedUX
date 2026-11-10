"use client";

import { Target } from "lucide-react";
import * as React from "react";

import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";
import { parseCharterKpis } from "@/lib/tome/curated-facts";

/**
 * What the project measures itself by, from its charter.
 *
 * Read off the charter's KPIs table, which is where a team agrees them. These
 * are the targets, not live readings: nothing in TOME measures a team's own
 * business metrics, and a baseline and a target that someone wrote down are
 * worth showing as exactly that.
 */

const SHOWN = 4;

export function HomeKpis({
  markdown,
  charterHref,
  onOpenCharter,
  ingestHref,
  onOpenIngest,
  container = false,
  className,
  loading = false,
}: {
  /** The charter page, or null when the project has none. */
  markdown: string | null;
  charterHref: string;
  onOpenCharter?: () => void;
  /**
   * Where a space without a charter at all is sent.
   *
   * A space is founded on one agent-written page now, so a charter is a page
   * that has to be written rather than one that arrives empty — and an
   * ingest is what writes it. Offering the page's own address instead would
   * send a reader to a wiki page that does not exist.
   */
  ingestHref: string;
  onOpenIngest?: () => void;
  /** Whether this space holds other spaces, which changes only the wording. */
  container?: boolean;
  className?: string;
  /**
   * Whether the page this reads is still on its way.
   *
   * Waiting and empty must not look alike: telling a reader the space has no
   * charter, a moment before one arrives, is worse than telling them nothing
   * yet.
   */
  loading?: boolean;
}) {
  const kpis = React.useMemo(
    () => (markdown ? parseCharterKpis(markdown) : []),
    [markdown],
  );

  return (
    <HomeCard
      title="KPIs"
      icon={<Target className="h-4 w-4" />}
      count={kpis.length}
      className={className}
      // Only where there is a page to open. A corner link to a page nobody
      // has written yet is a dead end dressed as a way through.
      action={
        markdown ? homeAction("Charter", charterHref, onOpenCharter) : undefined
      }
    >
      {loading ? (
        <HomeSkeleton />
      ) : kpis.length === 0 ? (
        <HomeEmpty
          icon={<Target />}
          headline={markdown ? "No KPIs filled in yet" : "No charter page yet"}
          hint={
            markdown
              ? "The charter's KPI table holds the baseline and the target this project measures itself against."
              : "A charter is written when there is something to put in it. The agent drafts one from what it reads, and the KPIs live in its table."
          }
          action={
            markdown
              ? homeAction("Open the charter", charterHref, onOpenCharter)
              : homeAction(
                  container ? "Ingest & synthesize" : "Run an ingest",
                  ingestHref,
                  onOpenIngest,
                )
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {kpis.slice(0, SHOWN).map((kpi) => (
            <li key={kpi.metric} className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {kpi.metric}
                </span>
                {kpi.target && (
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {kpi.target}
                  </span>
                )}
              </div>
              {(kpi.baseline || kpi.timeframe) && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {[
                    kpi.baseline && `from ${kpi.baseline}`,
                    kpi.timeframe && `by ${kpi.timeframe}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}
