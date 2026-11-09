"use client";

/**
 * The ways into TOME from the top: the catalogue read two ways, the overview
 * and the written week.
 *
 * A segmented control rather than the underlined tabs used inside a project,
 * because these are not sections of one page but answers to "what is going
 * on" at different lengths — a list, a set of cards, and prose. Which one a
 * reader wants is a matter of how much time they have.
 *
 * The same set the application navigation lists under TOME, and deliberately
 * so: a reader who found a view in the rail should find it here, and one who
 * collapsed the rail should not thereby lose a view.
 *
 * Plain buttons over the Tabs primitive: the panels below are whole pages of
 * their own, and mounting all of them so one can be shown would have the
 * catalogue and the overview both fetching on every visit.
 */

import { FolderKanban, LayoutGrid, Newspaper, Settings, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";

export const HUB_TABS = ["projects", "functions", "overview", "digest"] as const;

export type HubTab = (typeof HUB_TABS)[number];

/** Read a tab out of a query string, falling back to the catalogue. */
export function parseHubTab(value: string | null | undefined): HubTab {
  return HUB_TABS.includes(value as HubTab) ? (value as HubTab) : "projects";
}

// Worded as the rail words them, so the two read as one navigation rather
// than as two that happen to overlap.
const LABELS: Record<HubTab, { label: string; icon: React.ReactNode }> = {
  projects: { label: "By project", icon: <FolderKanban className="h-3.5 w-3.5" /> },
  functions: { label: "By function", icon: <Users className="h-3.5 w-3.5" /> },
  overview: { label: "Overview", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  digest: { label: "Digest", icon: <Newspaper className="h-3.5 w-3.5" /> },
};

export function HubTabs({
  value,
  onChange,
  settingsHref,
  className,
}: {
  value: HubTab;
  onChange: (tab: HubTab) => void;
  /**
   * Where TOME's own settings live.
   *
   * Kept beside the tabs rather than among them: it is a page of its own
   * rather than another reading of what is below, so it leaves rather than
   * switches. Drawn inside the same control all the same, because the rail
   * lists it with the rest and a reader should find the same set here.
   */
  settingsHref?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-border/60 bg-background/60 p-1 backdrop-blur",
        className,
      )}
    >
      <div role="tablist" aria-label="TOME views" className="inline-flex items-center gap-1">
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

      {settingsHref && (
        <>
          {/* A rule, not a gap: without it the link reads as a fifth tab
              that simply happens not to be selected. */}
          <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          <Link
            href={settingsHref}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-accent/60 hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Link>
        </>
      )}
    </div>
  );
}
