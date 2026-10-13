"use client";

import { Flag } from "lucide-react";
import * as React from "react";

import { HomeCard, HomeEmpty } from "@/components/tome/home/HomeCard";
import {
  parseRoadmapMilestones,
  upcomingMilestones,
  type MilestoneStatus,
} from "@/lib/tome/curated-facts";
import { cn } from "@/lib/utils";

/**
 * What the project has committed to, from its roadmap page.
 *
 * Read off the Milestones table rather than from stored data, because the
 * roadmap page is where milestones are agreed and there is nowhere else they
 * exist. That has one consequence worth knowing: the targets are shown as
 * they were written ("Q2 FY26"), never reinterpreted as dates, and the rows
 * keep the order the roadmap puts them in.
 */

const SHOWN = 4;

/** Done is muted, trouble is loud, and the middle states stay quiet. */
const STATUS_STYLE: Record<MilestoneStatus, string> = {
  done: "border-transparent bg-muted text-muted-foreground",
  at_risk: "border-destructive/40 text-destructive",
  blocked: "border-destructive/40 text-destructive",
  in_progress: "border-border text-foreground/80",
  not_started: "border-dashed border-border/70 text-muted-foreground",
  unknown: "border-dashed border-border/70 text-muted-foreground",
};

export function HomeMilestones({
  markdown,
  roadmapHref,
  onOpenRoadmap,
  className,
}: {
  /** The roadmap page, or null when the project has none. */
  markdown: string | null;
  roadmapHref: string;
  onOpenRoadmap?: () => void;
  className?: string;
}) {
  const milestones = React.useMemo(
    () => (markdown ? parseRoadmapMilestones(markdown) : []),
    [markdown],
  );
  const shown = React.useMemo(
    () => upcomingMilestones(milestones, SHOWN),
    [milestones],
  );

  return (
    <HomeCard
      title="Milestones"
      icon={<Flag className="h-4 w-4" />}
      count={milestones.length}
      className={className}
      action={
        onOpenRoadmap
          ? { label: "Roadmap", onClick: onOpenRoadmap }
          : { label: "Roadmap", href: roadmapHref }
      }
    >
      {shown.length === 0 ? (
        <HomeEmpty action={{ label: "Open the roadmap", href: roadmapHref }}>
          {markdown
            ? "The roadmap has no milestones filled in yet."
            : "This space has no roadmap page yet."}
        </HomeEmpty>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {shown.map((milestone) => (
            <li key={`${milestone.title}:${milestone.target}`} className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {milestone.title}
                </span>
                {milestone.statusLabel && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      STATUS_STYLE[milestone.status],
                    )}
                  >
                    {milestone.statusLabel}
                  </span>
                )}
              </div>
              {(milestone.target || milestone.owner) && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {[milestone.target, milestone.owner]
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
