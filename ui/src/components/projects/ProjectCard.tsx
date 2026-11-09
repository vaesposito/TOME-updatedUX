"use client";

/**
 * One project, as every list of projects draws it.
 *
 * Lifted out of the hub so the catalogue and the organisation show the same
 * card: two readings of the same projects that drew them differently would
 * read as two different things.
 */

import Link from "next/link";
import { BookOpen, History, UserX } from "lucide-react";

import { ProviderLogo } from "@/components/credentials/provider-logo";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { dataStewardLabel, type ProjectDocument } from "@/types/projects";
import type { ActiveIngestRun } from "@/types/tome";

export type EnrichedProject = ProjectDocument & {
  page_count?: number | null;
  last_ingested_at?: string | Date | null;
  last_edited_at?: string | Date | null;
  active_ingests?: ActiveIngestRun[];
};

export function elapsedLabel(since: string | Date | null | undefined): string {
  if (!since) return "just started";
  const ms = Date.now() - new Date(since).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just started";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}


/** "just started" already reads as a full phrase; only durations need the
 * "running for" prefix, else it reads as "running for just started". */
export function runningForLabel(since: string | Date | null | undefined): string {
  const elapsed = elapsedLabel(since);
  return elapsed === "just started" ? elapsed : `running for ${elapsed}`;
}

export function modeLabel(mode: ActiveIngestRun["mode"]): string {
  return mode === "bhag_rollup" ? "BHAG roll-up" : "Ingest";
}

/** Small pulsing dot used both on the hub header pill and per-card badge. */
export function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-2 w-2 shrink-0", className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
    </span>
  );
}

export function relativeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  const diffD = diffMs / (1000 * 60 * 60 * 24);

  if (diffH < 1) return "just now";
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffD < 7) return `${Math.floor(diffD)}d ago`;
  if (diffD < 30) {
    const w = Math.floor(diffD / 7);
    return `${w} week${w === 1 ? "" : "s"} ago`;
  }
  const mo = Math.floor(diffD / 30);
  return `${mo} month${mo === 1 ? "" : "s"} ago`;
}

export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

/** The card shows one headline number: whichever of "ingested" or "edited" is
 * more recent, since that's the freshness signal a viewer actually cares
 * about. Staleness coloring stays keyed to ingest specifically, since an
 * edit doesn't make out-of-date source content any less stale. */
export function activityLabel(
  lastIngestedAt: string | Date | null | undefined,
  lastEditedAt: string | Date | null | undefined,
): { text: string; tooltip: string; className: string } {
  const ingested = toDate(lastIngestedAt);
  const edited = toDate(lastEditedAt);

  if (!ingested && !edited) {
    return { text: "—", tooltip: "Never ingested or edited", className: "text-muted-foreground/30" };
  }

  const latest = !ingested || (edited && edited.getTime() > ingested.getTime()) ? edited! : ingested;
  const text = `${relativeAgo(latest)}`;

  const tooltipLines = [
    ingested ? `Ingested ${relativeAgo(ingested)}` : "Never ingested",
    edited ? `Edited ${relativeAgo(edited)}` : "No manual edits",
  ];

  const diffD = ingested ? (Date.now() - ingested.getTime()) / (1000 * 60 * 60 * 24) : null;
  const className =
    diffD !== null && diffD >= 30
      ? "text-amber-500"
      : diffD !== null && diffD >= 7
        ? "text-amber-500"
        : "text-muted-foreground";
  if (diffD !== null && diffD >= 30) tooltipLines.push("Content likely stale.");
  else if (diffD !== null && diffD >= 7) tooltipLines.push("Consider re-ingesting.");

  return { text, tooltip: tooltipLines.join(" · "), className };
}

export function stewardInitials(email: string): string {
  const local = email.split("@")[0];
  const parts = local.split(/[.\-_]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export function ProjectCard({ project }: { project: EnrichedProject }) {
  const steward = dataStewardLabel(project.data_steward);
  const freshness = activityLabel(project.last_ingested_at, project.last_edited_at);
  const activeRun = project.active_ingests?.[0];
  const repoCount = project.sources?.repos?.length ?? 0;
  const webexCount = project.sources?.webex_rooms?.length ?? 0;
  const confluenceCount = (project.sources?.confluence_spaces?.length ?? 0) ||
    (project.sources?.confluence_url ? 1 : 0);
  const hasSources = repoCount > 0 || confluenceCount > 0 || webexCount > 0;

  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group flex flex-col rounded-2xl border border-border/60 bg-card/50 p-5 transition hover:border-primary/40 hover:shadow-md"
    >
      <h3 className="font-semibold leading-snug group-hover:text-primary">{project.title}</h3>

      {/* Who keeps it and when it last moved, read together as one line:
          the title then has the width to wrap into. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              {steward ? (
                <>
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[8px] font-semibold text-primary">
                    {stewardInitials(steward)}
                  </span>
                  <span className="truncate max-w-[100px]">{steward.split("@")[0]}</span>
                </>
              ) : (
                <>
                  <UserX className="h-3 w-3" />
                  <span>No data steward</span>
                </>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {steward
              ? `Data steward: ${steward}`
              : "No data steward assigned. Set one in project settings."}
          </TooltipContent>
        </Tooltip>

        <span className="text-[11px] text-muted-foreground/40" aria-hidden>
          ·
        </span>

        {activeRun ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                <PulseDot />
                {activeRun.status === "running" ? "Ingesting" : "Queued"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {modeLabel(activeRun.mode)}{" "}
              {activeRun.status === "running"
                ? runningForLabel(activeRun.started_at)
                : "queued, waiting to start"}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] ${freshness.className}`}>
                <History className="h-3 w-3" />
                {freshness.text}
              </span>
            </TooltipTrigger>
            <TooltipContent>{freshness.tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <p className="mt-2 line-clamp-2 flex-grow text-sm text-muted-foreground">
        {project.description}
      </p>

      <div className="mt-4 space-y-2">
        {(hasSources || project.page_count != null) && (
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" />
                  {project.page_count ?? 0} {(project.page_count ?? 0) === 1 ? "page" : "pages"}
                </span>
              </TooltipTrigger>
              <TooltipContent>Wiki pages from the last ingest</TooltipContent>
            </Tooltip>
            {repoCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ProviderLogo provider="github" className="h-3.5 w-3.5 grayscale transition-all group-hover:grayscale-0" />
                    {repoCount} {repoCount === 1 ? "repo" : "repos"}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {repoCount} GitHub {repoCount === 1 ? "repository" : "repositories"} connected
                </TooltipContent>
              </Tooltip>
            )}
            {confluenceCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ProviderLogo provider="atlassian" className="h-3.5 w-3.5 object-contain grayscale transition-all group-hover:grayscale-0" />
                    {confluenceCount} {confluenceCount === 1 ? "space" : "spaces"}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{confluenceCount} Confluence {confluenceCount === 1 ? "space" : "spaces"} connected</TooltipContent>
              </Tooltip>
            )}
            {webexCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ProviderLogo provider="webex" className="h-3.5 w-3.5 object-contain grayscale transition-all group-hover:grayscale-0" />
                    {webexCount} {webexCount === 1 ? "room" : "rooms"}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {webexCount} Webex {webexCount === 1 ? "room" : "rooms"} connected
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

      </div>
    </Link>
  );
}
