"use client";

// assisted-by Cursor Composer

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  GripVertical,
  HelpCircle,
  History,
  Layers,
  ListOrdered,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Target,
  UserX,
  X,
} from "lucide-react";

import { ProjectOnboardingWizard } from "@/components/projects/ProjectOnboardingWizard";
import { McpConnectDialog } from "@/components/tome/McpConnectDialog";
import { OnboardingModal } from "@/components/tome/OnboardingModal";
import { OpenFgaModelRepairBanner } from "@/components/tome/OpenFgaModelRepairBanner";
import { AskTomePlaceholder } from "@/components/tome/AskTomePlaceholder";
import { TomeAssistantBubble } from "@/components/tome/TomeAssistantBubble";
import { TomeEmpty } from "@/components/tome/TomeEmpty";
import { TomeProductFeedback } from "@/components/tome/TomeProductFeedback";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import {
  HubTabs,
  parseHubTab,
  type HubTab,
} from "@/components/projects/HubTabs";
import { FunctionsView } from "@/components/projects/FunctionsView";
import { WorkspaceDigest } from "@/components/tome/WorkspaceDigest";
import { WorkspaceOverview } from "@/components/tome/WorkspaceOverview";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { normLabel } from "@/lib/projects/labels";
import { projectMatchesQuery } from "@/lib/tome/project-search";
import { projectGridClassName } from "@/lib/tome/project-grid";
import {
  applyBhagOrder,
  moveBhagAround,
} from "@/lib/tome/bhag-order";
import { isTourRunning } from "@/components/tour/notification-tour";
import { cn } from "@/lib/utils";
import { dataStewardLabel, type ProjectDocument } from "@/types/projects";
import type { ActiveIngestRun } from "@/types/tome";

type GroupBy = "none" | "initiative" | "area";

// Shared with TomeWiki so the first-run walkthrough shows once per browser
// across the hub and any project's wiki.
const ONBOARDING_SEEN_KEY = "tome.onboarding.seen";

// Silent background refresh so the active-ingest indicator clears/updates
// without a "Loading projects…" flicker on every tick.
const ACTIVE_INGEST_POLL_MS = 15_000;

type EnrichedProject = ProjectDocument & {
  page_count?: number | null;
  last_ingested_at?: string | Date | null;
  last_edited_at?: string | Date | null;
  active_ingests?: ActiveIngestRun[];
};

/** `name` is the stable hierarchy key used by project labels. `title` is the
 * editable display name, so visible hierarchy copy must prefer it without
 * changing the key used to resolve relationships. */
function hierarchyDisplayName(
  project: EnrichedProject | null | undefined,
  fallback: string,
): string {
  return project?.title?.trim() || project?.name?.trim() || fallback;
}

function elapsedLabel(since: string | Date | null | undefined): string {
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
function runningForLabel(since: string | Date | null | undefined): string {
  const elapsed = elapsedLabel(since);
  return elapsed === "just started" ? elapsed : `running for ${elapsed}`;
}

function modeLabel(mode: ActiveIngestRun["mode"]): string {
  return mode === "bhag_rollup" ? "BHAG roll-up" : "Ingest";
}

/** Small pulsing dot used both on the hub header pill and per-card badge. */
function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-2 w-2 shrink-0", className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
    </span>
  );
}

/** Hub-level indicator: lights up when any visible project has an in-flight
 * ingest/roll-up run, with a hovercard listing them. Data comes from the
 * `active_ingests` aggregate already on the projects payload — no extra
 * per-project polling. */
function ActiveIngestsIndicator({ runs }: { runs: ActiveIngestRun[] }) {
  const [open, setOpen] = useState(false);
  if (runs.length === 0) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
        <PulseDot />
        {runs.length} {runs.length === 1 ? "run" : "runs"} in progress
      </span>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Active runs
          </p>
          <ul className="space-y-2">
            {runs.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.project_title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {modeLabel(r.mode)} ·{" "}
                    {r.status === "running" ? elapsedLabel(r.started_at) : "waiting to start"}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                    r.status === "running"
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface OnboardingHeroConfig {
  title: string;
  description: string;
}

function relativeAgo(date: Date): string {
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

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

/** The card shows one headline number: whichever of "ingested" or "edited" is
 * more recent, since that's the freshness signal a viewer actually cares
 * about. Staleness coloring stays keyed to ingest specifically, since an
 * edit doesn't make out-of-date source content any less stale. */
function activityLabel(
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

function groupProjects(
  projects: EnrichedProject[],
  groupBy: GroupBy,
): { key: string; label: string; items: EnrichedProject[] }[] {
  if (groupBy === "none") return [{ key: "__all__", label: "", items: projects }];

  const map = new Map<string, EnrichedProject[]>();
  const ungrouped: EnrichedProject[] = [];

  for (const p of projects) {
    const values =
      groupBy === "initiative"
        ? (p.labels?.initiatives ?? [])
        : (p.labels?.areas ?? []);

    if (values.length === 0) {
      ungrouped.push(p);
    } else {
      for (const v of values) {
        if (!map.has(v)) map.set(v, []);
        map.get(v)!.push(p);
      }
    }
  }

  const groups = [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, items]) => ({ key, label: key, items }));

  if (ungrouped.length > 0) {
    groups.push({ key: "__ungrouped__", label: "Ungrouped", items: ungrouped });
  }

  return groups;
}

/** Split a BHAG group's projects into Area sub-groups (by their `labels.areas`
 * tags) and the skip-level projects that tag the BHAG directly with no area.
 * Derived from the tags actually present on these projects — not from a
 * promoted Area entity, since most areas start as bare tags before anyone
 * promotes one into a first-class wiki. */
function splitByArea(
  items: EnrichedProject[],
): { areaItems: { label: string; items: EnrichedProject[] }[]; skipLevel: EnrichedProject[] } {
  const map = new Map<string, EnrichedProject[]>();
  const skipLevel: EnrichedProject[] = [];

  for (const p of items) {
    const areaLabels = p.labels?.areas ?? [];
    if (areaLabels.length === 0) {
      skipLevel.push(p);
    } else {
      for (const a of areaLabels) {
        if (!map.has(a)) map.set(a, []);
        map.get(a)!.push(p);
      }
    }
  }

  const areaItems = [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([label, areaProjects]) => ({ label, items: areaProjects }));

  return { areaItems, skipLevel };
}

function stewardInitials(email: string): string {
  const local = email.split("@")[0];
  const parts = local.split(/[.\-_]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function ProjectCard({ project }: { project: EnrichedProject }) {
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
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold leading-snug group-hover:text-primary">{project.title}</h3>
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

/** One Area nested under a BHAG group: the Area entity (if promoted yet) plus
 * the projects tagged to it (via labels.areas). Rendered as its own
 * collapsible sub-accordion so the BHAG → Area → Project chain is visible. */
function AreaSubGroup({
  label,
  items,
  area,
  onCreateArea,
  creating,
}: {
  label: string;
  items: EnrichedProject[];
  area?: EnrichedProject | null;
  onCreateArea?: (label: string, items: EnrichedProject[]) => void;
  creating?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const displayName = hierarchyDisplayName(area, label);

  return (
    <div className="ml-4 space-y-2 border-l-2 border-sky-500/20 pl-4 sm:ml-6 sm:pl-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-grow items-center gap-2 text-left"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <Layers className="h-3.5 w-3.5 shrink-0 text-sky-500" />
          <span className="text-sm font-semibold text-sky-500">{displayName}</span>
          <span className="text-xs text-muted-foreground/50">{items.length}</span>
          <span className="ml-1 h-px flex-grow bg-border/30" />
        </button>

        {area ? (
          <Link
            href={`/projects/${area.slug}`}
            title={`Open ${displayName} wiki`}
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-600 transition hover:border-sky-500 hover:bg-sky-500/20 dark:text-sky-400"
          >
            <BookOpen className="h-3 w-3 shrink-0" />
            <span className="truncate">Open {displayName} wiki</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
          </Link>
        ) : onCreateArea ? (
          <button
            type="button"
            onClick={() => onCreateArea?.(label, items)}
            disabled={creating}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-sky-500/40 px-2.5 py-1 text-xs font-medium text-sky-500/80 transition hover:border-sky-500 hover:bg-sky-500/10 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            {creating ? "Creating…" : "Create area wiki"}
          </button>
        ) : null}
      </div>

      {!collapsed && items.length > 0 && (
        <div className={projectGridClassName()}>
          {items.map((p) => (
            <ProjectCard key={String(p._id)} project={p} />
          ))}
        </div>
      )}
      {!collapsed && items.length === 0 && (
        <p className="py-1 text-xs text-muted-foreground/70">No projects tagged to this area yet.</p>
      )}
    </div>
  );
}

function ProjectGroup({
  label,
  items,
  groupBy,
  bhag,
  area,
  parentBhagName,
  childAreas,
  onCreateBhag,
  onCreateArea,
  creating,
  creatingArea,
  reordering,
  dragging,
  dropIndicatorPlacement,
  onDragStart,
  onDragEnd,
  onDragOverGroup,
  onDrop,
}: {
  label: string;
  items: EnrichedProject[];
  groupBy: GroupBy;
  /** The BHAG entity matching this group's label, when groupBy="initiative". */
  bhag?: EnrichedProject | null;
  /** The Area entity matching this group's label, when groupBy="area". */
  area?: EnrichedProject | null;
  /** The BHAG this area belongs to (from area's labels.initiatives), for the breadcrumb. */
  parentBhagName?: string | null;
  /** Areas tagged to this BHAG (via labels.initiatives), each with its own
   * tagged projects — rendered as nested sub-accordions. groupBy="initiative" only. */
  childAreas?: { label: string; area: EnrichedProject | null; items: EnrichedProject[] }[];
  /** Promote this initiative label into a first-class BHAG wiki. */
  onCreateBhag?: (label: string, items: EnrichedProject[]) => void;
  /** Promote this area label into a first-class Area wiki. Called with the
   * parent BHAG's name when creating from a BHAG group's nested Area
   * sub-accordion (see `handleAreaCreate` below); omitted from the flat
   * "Group by Area" view, which has no BHAG context. */
  onCreateArea?: (label: string, items: EnrichedProject[], parentBhagName?: string) => void;
  creating?: boolean;
  /** Which area label (normalized) is currently being created, for the nested buttons. */
  creatingArea?: string | null;
  reordering?: boolean;
  dragging?: boolean;
  /** Where the dragged BHAG would land relative to this group, or null if
   * this group isn't the current drag-over target — renders a ghost line. */
  dropIndicatorPlacement?: "before" | "after" | null;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Fires on dragover with the placement the drop would use, so the parent
   * can show a ghost/drop-indicator line before the drop actually happens. */
  onDragOverGroup?: (placement: "before" | "after") => void;
  onDrop?: (placement: "before" | "after") => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isUngrouped = label === "Ungrouped";
  const isBhagGroup = groupBy === "initiative" && !isUngrouped;
  const isAreaGroup = groupBy === "area" && !isUngrouped;
  const displayLabel = isBhagGroup
    ? hierarchyDisplayName(bhag, label)
    : isAreaGroup
      ? hierarchyDisplayName(area, label)
      : label;
  // Nested Area sub-accordions live only under a BHAG group, so this group's
  // own `label` is their parent BHAG's name.
  const handleAreaCreate = useCallback(
    (areaLabel: string, items: EnrichedProject[]) =>
      onCreateArea?.(areaLabel, items, isBhagGroup ? label : undefined),
    [onCreateArea, isBhagGroup, label],
  );
  const labelClass = isUngrouped
    ? "text-sm font-medium text-muted-foreground"
    : groupBy === "initiative"
      ? "text-sm font-semibold text-primary"
      : "text-sm font-semibold text-sky-500";

  return (
    <div
      className={cn(
        "relative space-y-3 rounded-xl transition",
        dragging && "scale-[0.995] bg-primary/5 opacity-60",
      )}
      onDragOver={
        reordering
          ? (event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              onDragOverGroup?.(
                event.clientY > bounds.top + bounds.height / 2 ? "after" : "before",
              );
            }
          : undefined
      }
      onDrop={
        reordering
          ? (event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              onDrop?.(event.clientY > bounds.top + bounds.height / 2 ? "after" : "before");
            }
          : undefined
      }
    >
      {dropIndicatorPlacement === "before" && (
        <div className="absolute -top-1.5 left-0 right-0 h-0.5 rounded-full bg-primary" />
      )}
      <div className="flex items-center gap-3">
        {isBhagGroup && reordering && (
          <div
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", normLabel(label));
              onDragStart?.();
            }}
            onDragEnd={onDragEnd}
            className="flex cursor-grab items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
            aria-label={`Drag to reorder BHAG ${displayLabel}`}
            title="Drag to reorder BHAG"
          >
            <GripVertical className="h-4 w-4" />
            <span className="hidden sm:inline">Move</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-grow items-center gap-2 text-left"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {isBhagGroup && <Target className="h-4 w-4 shrink-0 text-primary" />}
          {isAreaGroup && <Layers className="h-4 w-4 shrink-0 text-sky-500" />}
          <span className={labelClass}>{displayLabel}</span>
          {/* Breadcrumb: show which BHAG this area belongs to */}
          {isAreaGroup && parentBhagName && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs text-primary/70">
              <Target className="h-2.5 w-2.5" />
              {parentBhagName}
            </span>
          )}
          <span className="text-xs text-muted-foreground/50">{items.length}</span>
          <span className="ml-1 h-px flex-grow bg-border/40" />
        </button>

        {/* BHAG front door: open the strategic-goal wiki, or promote this
            initiative into one. Kept prominent so it's clear and apparent. */}
        {isBhagGroup &&
          (bhag ? (
            <Link
              href={`/projects/${bhag.slug}`}
              title={`Open ${hierarchyDisplayName(bhag, label)} BHAG wiki`}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:border-primary hover:bg-primary/20"
            >
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                Open {hierarchyDisplayName(bhag, label)} BHAG wiki
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            </Link>
          ) : onCreateBhag ? (
            <button
              type="button"
              onClick={() => onCreateBhag?.(label, items)}
              disabled={creating}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-1.5 text-xs font-medium text-primary/80 transition hover:border-primary hover:bg-primary/10 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {creating ? "Creating…" : "Create BHAG wiki"}
            </button>
          ) : null)}

        {/* Area front door: open the area wiki, or promote this area label into one. */}
        {isAreaGroup &&
          (area ? (
            <Link
              href={`/projects/${area.slug}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-600 transition hover:border-sky-500 hover:bg-sky-500/20 dark:text-sky-400"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Open {hierarchyDisplayName(area, label)} wiki
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : onCreateArea ? (
            <button
              type="button"
              onClick={() => onCreateArea?.(label, items)}
              disabled={creating}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-sky-500/40 px-3 py-1.5 text-xs font-medium text-sky-500/80 transition hover:border-sky-500 hover:bg-sky-500/10 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {creating ? "Creating…" : "Create area wiki"}
            </button>
          ) : null)}
      </div>

      {!collapsed && (
        <div className="space-y-4">
          {isBhagGroup && childAreas && childAreas.length > 0 && (
            <div className="space-y-3">
              {childAreas.map((ca) => (
                <AreaSubGroup
                  key={ca.label}
                  label={ca.label}
                  items={ca.items}
                  area={ca.area}
                  onCreateArea={onCreateArea ? handleAreaCreate : undefined}
                  creating={creatingArea === normLabel(ca.label)}
                />
              ))}
            </div>
          )}

          {isBhagGroup && childAreas && childAreas.length > 0 && items.length > 0 && (
            <p className="pl-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Tagged directly (no area)
            </p>
          )}

          {items.length > 0 && (
            <div className={projectGridClassName()}>
              {items.map((p) => (
                <ProjectCard key={String(p._id)} project={p} />
              ))}
            </div>
          )}
        </div>
      )}
      {dropIndicatorPlacement === "after" && (
        <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded-full bg-primary" />
      )}
    </div>
  );
}

export function ProjectsHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [bhags, setBhags] = useState<EnrichedProject[]>([]);
  const [areas, setAreas] = useState<EnrichedProject[]>([]);
  const [creatingBhag, setCreatingBhag] = useState<string | null>(null);
  const [creatingArea, setCreatingArea] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hero, setHero] = useState<OnboardingHeroConfig>({
    title: "Welcome to TOME",
    description: "Outshift Memory Engine",
  });
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  /**
   * Which of the three views is open, kept in the address bar.
   *
   * So that the overview and the digest can be linked to and come back on a
   * refresh. Read on every render rather than copied into state, because the
   * query string is the one record of it.
   */
  // A ?groupBy=function link predates the tab and still has to land on it,
  // or the view would open with the catalogue grouped one way and the tab
  // bar claiming the other.
  const tab = parseHubTab(
    searchParams.get("tab")
      ?? (searchParams.get("groupBy") === "function" ? "functions" : null),
  );
  const setTab = useCallback(
    (next: HubTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "projects") params.delete("tab");
      else params.set("tab", next);
      const query = params.toString();
      // Replaced, not pushed: moving between the three is looking around, and
      // Back should leave TOME rather than walk the tabs in reverse.
      router.replace(query ? `/projects?${query}` : "/projects", {
        scroll: false,
      });
    },
    [router, searchParams],
  );
  const [isTomeAdmin, setIsTomeAdmin] = useState(false);
  const [bhagOrder, setBhagOrder] = useState<string[]>([]);
  const [reordering, setReordering] = useState(false);
  const [draggedBhag, setDraggedBhag] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    label: string;
    placement: "before" | "after";
  } | null>(null);
  const [orderSaving, setOrderSaving] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");

  // First-run walkthrough, once per browser (shared key with the wiki). The
  // Help button reopens it any time.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isTourRunning()) return;
    if (!window.localStorage.getItem(ONBOARDING_SEEN_KEY)) setOnboardingOpen(true);
  }, []);

  const handleOnboardingChange = useCallback((open: boolean) => {
    setOnboardingOpen(open);
    if (!open && typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    }
  }, []);

  // Projects are read by the goal they belong to, so that is the grouping,
  // and there is no control offering the other two. A ?groupBy= link still
  // works for anyone who wants a flat list or areas.
  const groupBy = (searchParams.get("groupBy") ?? "initiative") as GroupBy;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      // Real projects (BHAGs are filtered out server-side) and BHAG entities are
      // fetched separately; BHAGs enrich the Group-by-BHAG headers rather than
      // appearing as project cards.
      const [projRes, bhagRes, areaRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/projects?type=bhag"),
        fetch("/api/projects?type=area"),
      ]);
      const projBody = await projRes.json();
      if (!projRes.ok) throw new Error(projBody.error ?? "Failed to load projects");
      setProjects((projBody.data?.projects ?? []) as EnrichedProject[]);
      if (bhagRes.ok) {
        const bhagBody = await bhagRes.json();
        setBhags((bhagBody.data?.projects ?? []) as EnrichedProject[]);
      }
      if (areaRes.ok) {
        const areaBody = await areaRes.json();
        setAreas((areaBody.data?.projects ?? []) as EnrichedProject[]);
      }
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Index BHAG entities by slug (the stable key stored in labels.initiatives
  // post-migration) AND by legacy frozen name (for any relationship tagged
  // before project_labels_to_slug_v1 ran, or never matched by it) so a
  // Group-by-BHAG section can find the entity under either convention.
  const bhagByLabel = new Map<string, EnrichedProject>();
  for (const b of bhags) {
    bhagByLabel.set(normLabel(b.slug), b);
    if (b.name) bhagByLabel.set(normLabel(b.name), b);
  }

  // Index Area entities the same way for the Group-by-Area view.
  const areaByLabel = new Map<string, EnrichedProject>();
  for (const a of areas) {
    areaByLabel.set(normLabel(a.slug), a);
    if (a.name) areaByLabel.set(normLabel(a.name), a);
  }

  // Areas tagged to a BHAG (via labels.initiatives), keyed by the BHAG's
  // normalized label, so a Group-by-BHAG section can nest its Areas.
  const areasByBhagLabel = new Map<string, EnrichedProject[]>();
  for (const a of areas) {
    for (const bhagLabel of a.labels?.initiatives ?? []) {
      const key = normLabel(bhagLabel);
      if (!areasByBhagLabel.has(key)) areasByBhagLabel.set(key, []);
      areasByBhagLabel.get(key)!.push(a);
    }
  }

  const normalizedProjectQuery = projectQuery.trim();
  const filteredProjects = normalizedProjectQuery
    ? projects.filter((project) => projectMatchesQuery(project, normalizedProjectQuery))
    : projects;

  // Projects tagged to an Area (via labels.areas), keyed by the Area's
  // normalized label, so each Area sub-accordion can list its own projects.
  const projectsByAreaLabel = new Map<string, EnrichedProject[]>();
  for (const p of filteredProjects) {
    for (const areaLabel of p.labels?.areas ?? []) {
      const key = normLabel(areaLabel);
      if (!projectsByAreaLabel.has(key)) projectsByAreaLabel.set(key, []);
      projectsByAreaLabel.get(key)!.push(p);
    }
  }

  // Promote an initiative label into a first-class BHAG wiki. The BHAG inherits
  // the team of the projects already tagged with it, then we route to its wiki.
  const handleCreateBhag = useCallback(
    async (label: string, items: EnrichedProject[]) => {
      const teamId = items[0]?.team_slug || items[0]?.team_id;
      if (!teamId) {
        setError("Cannot create a BHAG: no team found for this group.");
        return;
      }
      setCreatingBhag(normLabel(label));
      setError(null);
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: label, type: "bhag", team_id: teamId }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to create BHAG");
        const slug = body.data?.project?.slug;
        if (slug) router.push(`/projects/${slug}`);
      } catch (err) {
        toast(`Could not create BHAG: ${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        setCreatingBhag(null);
      }
    },
    [router, toast],
  );

  // `parentBhagName` is set for calls originating from a BHAG group's nested
  // Area sub-accordion (the calling context knows which BHAG it's under) so
  // the new Area is linked into the hierarchy immediately, rather than
  // becoming an orphaned bare label like the flat "Group by Area" view (which
  // has no BHAG context and leaves `initiatives` unset).
  const handleCreateArea = useCallback(
    async (label: string, items: EnrichedProject[], parentBhagName?: string) => {
      const teamId = items[0]?.team_slug || items[0]?.team_id;
      if (!teamId) {
        setError("Cannot create an Area: no team found for this group.");
        return;
      }
      setCreatingArea(normLabel(label));
      setError(null);
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: label,
            type: "area",
            team_id: teamId,
            ...(parentBhagName ? { initiatives: [parentBhagName] } : {}),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to create Area");
        const slug = body.data?.project?.slug;
        if (slug) router.push(`/projects/${slug}`);
      } catch (err) {
        toast(`Could not create Area: ${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        setCreatingArea(null);
      }
    },
    [router, toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/tome/preferences/bhag-order")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load BHAG order");
        setBhagOrder(body.data?.bhag_order ?? []);
      })
      .catch(() => undefined);
  }, []);

  const persistBhagOrder = useCallback(
    async (next: string[], previous: string[]) => {
      setBhagOrder(next);
      setOrderSaving(true);
      try {
        const res = await fetch("/api/tome/preferences/bhag-order", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bhag_order: next }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to save BHAG order");
        setBhagOrder(body.data?.bhag_order ?? next);
      } catch (err) {
        setBhagOrder(previous);
        toast(
          `Could not save BHAG order: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      } finally {
        setOrderSaving(false);
      }
    },
    [toast],
  );

  const handleBhagDrop = useCallback(
    (targetLabel: string, placement: "before" | "after", visibleOrder: string[]) => {
      setDropIndicator(null);
      if (!draggedBhag || draggedBhag === targetLabel) {
        setDraggedBhag(null);
        return;
      }
      const previous = visibleOrder;
      const next = moveBhagAround(previous, draggedBhag, targetLabel, placement);
      setDraggedBhag(null);
      void persistBhagOrder(next, previous);
    },
    [draggedBhag, persistBhagOrder],
  );

  const resetBhagOrder = useCallback(() => {
    void persistBhagOrder([], bhagOrder);
  }, [persistBhagOrder, bhagOrder]);

  // Keep the active-ingest indicator live without re-triggering the loading
  // state on every tick.
  useEffect(() => {
    const id = setInterval(() => void load({ silent: true }), ACTIVE_INGEST_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    fetch("/api/projects/onboarding-config")
      .then((res) => res.json())
      .then((body) => {
        const config = body.data?.config;
        if (config?.hero) setHero(config.hero);
      })
      .catch(() => undefined);

    fetch("/api/tome/admin")
      .then((res) => res.json())
      .then((body) => setIsTomeAdmin(Boolean(body.isTomeAdmin)))
      .catch(() => undefined);

  }, []);

  // A promoted BHAG/Area entity with zero tagged children never appears as a
  // group on its own (groupProjects only derives groups from tags actually
  // present on `projects`) — invisible right after creation until someone
  // tags a project to it. Inject an empty group for any entity not already
  // covered, so a freshly created BHAG/Area is findable immediately.
  const entitiesForGroupBy = groupBy === "initiative" ? bhags : groupBy === "area" ? areas : [];
  let groups = groupProjects(filteredProjects, groupBy);
  if (!normalizedProjectQuery && (groupBy === "initiative" || groupBy === "area")) {
    const covered = new Set(groups.map((g) => normLabel(g.label)));
    for (const entity of entitiesForGroupBy) {
      const key = normLabel(entity.slug);
      // A relationship tagged before the migration (or never matched by it)
      // groups under the entity's legacy frozen name, not its slug — check
      // both so an already-covered legacy-tagged entity isn't double-added.
      if (covered.has(key) || (entity.name && covered.has(normLabel(entity.name)))) continue;
      covered.add(key);
      // `label` stays the slug — it's the lookup key used throughout this
      // component (bhagByLabel/areaByLabel, drag-order, creating state);
      // ProjectGroup resolves the human-readable display via
      // hierarchyDisplayName(bhag/area, label) once the entity is matched.
      groups.splice(groups.length > 0 && groups[groups.length - 1].key === "__ungrouped__" ? groups.length - 1 : groups.length, 0, {
        key: entity.slug,
        label: entity.slug,
        items: [],
      });
    }
  }
  if (groupBy === "initiative") {
    const ungrouped = groups.filter((group) => group.key === "__ungrouped__");
    groups = [
      ...applyBhagOrder(
        groups.filter((group) => group.key !== "__ungrouped__"),
        bhagOrder,
      ),
      ...ungrouped,
    ];
  }
  const visibleBhagOrder =
    groupBy === "initiative"
      ? groups
          .filter((group) => group.key !== "__ungrouped__")
          .map((group) => normLabel(group.label))
      : [];
  const activeIngests = filteredProjects.flatMap((p) => p.active_ingests ?? []);

  return (
    <div className="relative isolate mx-auto w-full max-w-[1600px] space-y-8 p-6">
      {/* A wash in the corner the eye leaves last, so the three tabs sit on
          something rather than on nothing. Two discs rather than one, so the
          colour turns across the corner instead of sitting there flat, and
          far enough down in opacity that it reads as depth rather than as a
          shape. Both are fixed, so they hold still while a long list of
          projects scrolls past them. */}
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 right-0 -z-10 h-[40rem] w-[40rem] translate-x-1/4 translate-y-1/4 rounded-full bg-[hsla(270,75%,60%,0.16)] blur-[130px]"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 right-[18rem] -z-10 h-[32rem] w-[32rem] translate-y-1/3 rounded-full bg-[hsla(214,85%,55%,0.14)] blur-[130px]"
      />

      <section className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/10 via-background to-primary/5 p-5 md:p-6">
        <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
                <FolderKanban className="h-7 w-7 shrink-0 text-primary md:h-8 md:w-8" />
                {hero.title}
              </h1>
              <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                {hero.description}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isTomeAdmin && (
                <Link
                  href="/projects/admin"
                  title="TOME Settings"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </Link>
              )}
              <TomeProductFeedback variant="link" />
            </div>
          </div>

        </div>
      </section>

      {/* Under the welcome rather than above the list, because they are three
          readings of the same thing and none of them is a section of the
          catalogue. Outside the band, so the band stays a greeting. */}
      <div className="flex justify-center">
        <HubTabs value={tab} onChange={setTab} />
      </div>

      {isTomeAdmin && <OpenFgaModelRepairBanner />}

      {/* The overview is mounted only while it is open, because it fetches on
          mount and nothing it holds is worth keeping. The catalogue below is
          hidden instead: it carries a search, a grouping and a reorder mode a
          reader has set, over three requests, and dropping that to look at
          the digest for a moment would be a poor trade. */}
      {tab === "overview" && <WorkspaceOverview />}
      {tab === "digest" && <WorkspaceDigest />}
      {/* Reads the catalogue the hub already loaded, so moving between the
          two readings costs nothing, but draws the functions rather than the
          projects: the reader asked what each part of the organisation
          keeps, and a wall of project cards answers the other question. */}
      {tab === "functions" && (
        <FunctionsView
          spaces={projects.map((project) => ({
            slug: project.slug,
            title: project.title || project.name || project.slug,
            functions: project.labels?.functions ?? [],
          }))}
        />
      )}

      <section className={cn("space-y-6", tab !== "projects" && "hidden")}>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="whitespace-nowrap text-xl font-semibold">
              {loading
                ? "Your projects"
                : normalizedProjectQuery
                  ? `${filteredProjects.length} of ${projects.length} projects`
                  : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
            </h2>
            <ActiveIngestsIndicator runs={activeIngests} />
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder="Find project…"
                aria-label="Find a TOME project"
                className="h-8 w-full rounded-lg border border-border/60 bg-background/40 pl-8 pr-8 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 hover:border-border focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/15 [&::-webkit-search-cancel-button]:hidden"
              />
              {projectQuery && (
                <button
                  type="button"
                  onClick={() => setProjectQuery("")}
                  aria-label="Clear project search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => setOnboardingOpen(true)}
                    aria-label="What is TOME?"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">What is TOME?</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ProjectOnboardingWizard
              onComplete={() => void load()}
              initialOpen={searchParams.get("onboard") === "1"}
            />
            <McpConnectDialog initialOpen={searchParams.get("mcp") === "1"} />
            {isTomeAdmin && groupBy === "initiative" && (
              <>
                <Button
                  variant={reordering ? "secondary" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  disabled={loading || visibleBhagOrder.length < 2 || orderSaving}
                  onClick={() => setReordering((current) => !current)}
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                  {orderSaving ? "Saving…" : reordering ? "Done" : "Reorder BHAGs"}
                </Button>
                {reordering && bhagOrder.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground"
                    disabled={orderSaving}
                    onClick={resetBhagOrder}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading projects…</p>}
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {!loading && projects.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border">
            <TomeEmpty
              icon={<FolderKanban />}
              headline="No projects yet"
              hint="A project is a space with a wiki, the sources it reads and the people who follow it. Add one and it appears in this list."
            />
          </div>
        )}

        {!loading && projects.length > 0 && filteredProjects.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border">
            <TomeEmpty
              icon={<Search />}
              headline="No projects match your search"
              hint={`Nothing in this list matches \u201C${normalizedProjectQuery}\u201D. Clearing the search brings every project back.`}
              action={{ label: "Clear search", onClick: () => setProjectQuery("") }}
            />
          </div>
        )}

        {filteredProjects.length > 0 && (
          <TooltipProvider>
            {groupBy === "none" ? (
              <div className={projectGridClassName()}>
                {groups[0]?.items.map((p) => (
                  <ProjectCard key={String(p._id)} project={p} />
                ))}
              </div>
            ) : (
              <div className="space-y-8">
                {groups.map((g) => {
                const areaEntity = groupBy === "area" ? areaByLabel.get(normLabel(g.label)) : null;
                const parentBhagLabel = areaEntity?.labels?.initiatives?.[0] ?? null;
                const parentBhagName = parentBhagLabel
                  ? hierarchyDisplayName(
                      bhagByLabel.get(normLabel(parentBhagLabel)),
                      parentBhagLabel,
                    )
                  : null;

                // Areas nested under a BHAG group come from two sources, merged:
                // (1) promoted Area entities whose own labels.initiatives point
                // here — the forward-looking, entity-first path, discoverable
                // even if none of their child projects also tag this BHAG
                // directly; (2) area tags found on this BHAG's own skip-level
                // items — legacy/unpromoted areas (e.g. a free-text tag like
                // "CFN" typed before anyone ran "Create area wiki") that would
                // otherwise be invisible until promoted.
                let childAreas:
                  | { label: string; area: EnrichedProject | null; items: EnrichedProject[] }[]
                  | undefined;
                let displayItems = g.items;
                if (groupBy === "initiative") {
                  const { areaItems: taggedAreaItems, skipLevel } = splitByArea(g.items);
                  const merged = new Map<
                    string,
                    { label: string; area: EnrichedProject | null; items: EnrichedProject[] }
                  >();
                  for (const ai of taggedAreaItems) {
                    // Canonicalize on the resolved entity's slug so a legacy
                    // name-tagged group and a slug-tagged group for the SAME
                    // area merge into one entry instead of appearing twice.
                    const resolvedArea = areaByLabel.get(normLabel(ai.label)) ?? null;
                    const canonicalKey = resolvedArea ? normLabel(resolvedArea.slug) : normLabel(ai.label);
                    merged.set(canonicalKey, {
                      label: resolvedArea ? resolvedArea.slug : ai.label,
                      area: resolvedArea,
                      items: ai.items,
                    });
                  }
                  for (const a of areasByBhagLabel.get(normLabel(g.label)) ?? []) {
                    const key = normLabel(a.slug);
                    // Children may tag this area by its slug (post-migration)
                    // or its legacy frozen name — gather both, deduped.
                    const bySlug = projectsByAreaLabel.get(key) ?? [];
                    const byName = a.name ? projectsByAreaLabel.get(normLabel(a.name)) ?? [] : [];
                    const entityItems = [
                      ...new Map([...bySlug, ...byName].map((p) => [String(p._id), p])).values(),
                    ];
                    const existing = merged.get(key);
                    if (normalizedProjectQuery && entityItems.length === 0 && !existing) continue;
                    if (existing) {
                      const byId = new Map(existing.items.map((p) => [String(p._id), p]));
                      for (const p of entityItems) byId.set(String(p._id), p);
                      merged.set(key, { label: a.slug, area: a, items: [...byId.values()] });
                    } else {
                      merged.set(key, { label: a.slug, area: a, items: entityItems });
                    }
                  }
                  childAreas = [...merged.values()].sort(
                    (a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label),
                  );
                  displayItems = skipLevel;
                }

                return (
                  <ProjectGroup
                    key={g.key}
                    label={g.label}
                    items={displayItems}
                    groupBy={groupBy}
                    bhag={groupBy === "initiative" ? bhagByLabel.get(normLabel(g.label)) : null}
                    area={areaEntity}
                    parentBhagName={parentBhagName}
                    childAreas={childAreas}
                    onCreateBhag={isTomeAdmin ? handleCreateBhag : undefined}
                    onCreateArea={isTomeAdmin ? handleCreateArea : undefined}
                    creating={
                      groupBy === "initiative"
                        ? creatingBhag === normLabel(g.label)
                        : creatingArea === normLabel(g.label)
                    }
                    creatingArea={creatingArea}
                    reordering={
                      reordering &&
                      groupBy === "initiative" &&
                      g.key !== "__ungrouped__"
                    }
                    dragging={draggedBhag === normLabel(g.label)}
                    dropIndicatorPlacement={
                      dropIndicator?.label === normLabel(g.label) ? dropIndicator.placement : null
                    }
                    onDragStart={() => setDraggedBhag(normLabel(g.label))}
                    onDragEnd={() => {
                      setDraggedBhag(null);
                      setDropIndicator(null);
                    }}
                    onDragOverGroup={(placement) =>
                      setDropIndicator({ label: normLabel(g.label), placement })
                    }
                    onDrop={(placement) =>
                      handleBhagDrop(normLabel(g.label), placement, visibleBhagOrder)
                    }
                  />
                );
                })}
              </div>
            )}
          </TooltipProvider>
        )}
      </section>

      {!error && (
        <>
          <TomeAssistantBubble />
          {/* Stands in only where the real one is switched off. */}
          <AskTomePlaceholder />
        </>
      )}
      <OnboardingModal open={onboardingOpen} onOpenChange={handleOnboardingChange} />
    </div>
  );
}
