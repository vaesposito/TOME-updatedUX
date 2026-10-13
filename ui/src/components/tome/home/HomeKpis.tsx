"use client";

import { Target } from "lucide-react";
import * as React from "react";

import {
  HomeCard,
  HomeEmpty,
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
  className,
}: {
  /** The charter page, or null when the project has none. */
  markdown: string | null;
  charterHref: string;
  onOpenCharter?: () => void;
  className?: string;
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
      action={homeAction("Charter", charterHref, onOpenCharter)}
    >
      {kpis.length === 0 ? (
        <HomeEmpty
          icon={<Target />}
          headline={markdown ? "No KPIs filled in yet" : "No charter page yet"}
          hint="The charter's KPI table holds the baseline and the target this project measures itself against."
          action={homeAction("Open the charter", charterHref, onOpenCharter)}
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
