"use client";

/**
 * The three ways into TOME from the top: the catalogue, the digest and the
 * written week.
 *
 * A segmented control rather than the underlined tabs used inside a project,
 * because these are not sections of one page but three answers to "what is
 * going on" at three lengths — a list, a set of cards, and prose. Which one a
 * reader wants is a matter of how much time they have.
 *
 * Plain buttons over the Tabs primitive: the panels below are whole pages of
 * their own, and mounting all three so one can be shown would have the
 * catalogue and the overview both fetching on every visit.
 */

import { FolderKanban, LayoutGrid, Newspaper } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export const HUB_TABS = ["projects", "overview", "digest"] as const;

export type HubTab = (typeof HUB_TABS)[number];

/** Read a tab out of a query string, falling back to the catalogue. */
export function parseHubTab(value: string | null | undefined): HubTab {
  return HUB_TABS.includes(value as HubTab) ? (value as HubTab) : "projects";
}

const LABELS: Record<HubTab, { label: string; icon: React.ReactNode }> = {
  projects: { label: "Projects", icon: <FolderKanban className="h-3.5 w-3.5" /> },
  overview: { label: "Overview", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  digest: { label: "Digest", icon: <Newspaper className="h-3.5 w-3.5" /> },
};

export function HubTabs({
  value,
  onChange,
  className,
}: {
  value: HubTab;
  onChange: (tab: HubTab) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="TOME views"
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-border/60 bg-background/60 p-1 backdrop-blur",
        className,
      )}
    >
      {HUB_TABS.map((tab) => {
        const active = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {LABELS[tab].icon}
            {LABELS[tab].label}
          </button>
        );
      })}
    </div>
  );
}
