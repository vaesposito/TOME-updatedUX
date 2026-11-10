"use client";

// assisted-by Cursor Composer

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  FolderKanban,
  GripVertical,
  Layers,
  ListOrdered,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Target,
} from "lucide-react";

import { SpaceCreationFlow } from "@/components/projects/SpaceCreationFlow";
import { McpConnectDialog } from "@/components/tome/McpConnectDialog";
import { OnboardingModal } from "@/components/tome/OnboardingModal";
import { TourMenu } from "@/components/tour/TourStartButton";
import { HUB_CTA_CLASS } from "@/components/projects/hub-cta";
import { OpenFgaModelRepairBanner } from "@/components/tome/OpenFgaModelRepairBanner";
import { AskTomePlaceholder } from "@/components/tome/AskTomePlaceholder";
import { TomeAssistantBubble } from "@/components/tome/TomeAssistantBubble";
import { TomeEmpty } from "@/components/tome/TomeEmpty";
import { TomeProductFeedback } from "@/components/tome/TomeProductFeedback";
import {
  HubTabs,
  parseHubTab,
  type HubTab,
} from "@/components/projects/HubTabs";
import {
  HubHeading,
  HubSearchField,
  HubToolbar,
} from "@/components/projects/HubToolbar";
import { HubGroup, HubGroupRun } from "@/components/projects/HubGroup";
import { FunctionsView } from "@/components/projects/FunctionsView";
import {
  ProjectCard,
  PulseDot,
  elapsedLabel,
  modeLabel,
  type EnrichedProject,
} from "@/components/projects/ProjectCard";
import { TomeVersionNote } from "@/components/projects/TomeVersionNote";
import { WorkspaceDigest } from "@/components/tome/WorkspaceDigest";
import { WorkspaceOverview } from "@/components/tome/WorkspaceOverview";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { normLabel } from "@/lib/projects/labels";
import { partitionSpaces } from "@/lib/projects/placement";
import { projectMatchesQuery } from "@/lib/tome/project-search";
import { projectGridClassName } from "@/lib/tome/project-grid";
import {
  applyBhagOrder,
  moveBhagAround,
} from "@/lib/tome/bhag-order";
import { isTourRunning } from "@/components/tour/notification-tour";
import { cn } from "@/lib/utils";
import type { ActiveIngestRun } from "@/types/tome";

type GroupBy = "none" | "initiative" | "area";

// Shared with TomeWiki so the first-run walkthrough shows once per browser
// across the hub and any project's wiki.
const ONBOARDING_SEEN_KEY = "tome.onboarding.seen";

// Silent background refresh so the active-ingest indicator clears/updates
// without a "Loading projects…" flicker on every tick.
const ACTIVE_INGEST_POLL_MS = 15_000;

/** `name` is the stable hierarchy key used by project labels. `title` is the
 * editable display name, so visible hierarchy copy must prefer it without
 * changing the key used to resolve relationships. */
function hierarchyDisplayName(
  project: EnrichedProject | null | undefined,
  fallback: string,
): string {
  return project?.title?.trim() || project?.name?.trim() || fallback;
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
  const displayName = hierarchyDisplayName(area, label);

  return (
    <HubGroup
      level="nested"
      name={displayName}
      href={area ? `/projects/${area.slug}` : undefined}
      labelClassName="text-sm font-semibold text-sky-500"
      icon={<Layers className="h-3.5 w-3.5 shrink-0 text-sky-500" />}
      count={items.length}
      action={
        !area && onCreateArea
          ? {
              label: creating ? "Creating…" : "Create wiki",
              onClick: () => onCreateArea(label, items),
              disabled: creating,
            }
          : undefined
      }
    >
      {items.length > 0 ? (
        <div className={projectGridClassName()}>
          {items.map((p) => (
            <ProjectCard key={String(p._id)} project={p} />
          ))}
        </div>
      ) : (
        <p className="py-1 text-xs text-muted-foreground/70">No projects tagged to this area yet.</p>
      )}
    </HubGroup>
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
  const isUngrouped = label === "Ungrouped";
  const isBhagGroup = groupBy === "initiative" && !isUngrouped;
  const isAreaGroup = groupBy === "area" && !isUngrouped;
  const displayLabel = isBhagGroup
    ? hierarchyDisplayName(bhag, label)
    : isAreaGroup
      ? hierarchyDisplayName(area, label)
      : label;
  // The space this group is, where it is one: a BHAG group may have been
  // promoted into a BHAG, an Area group into an Area. Where it has, the
  // group's name leads to it.
  const hierarchyEntity = isBhagGroup ? bhag : isAreaGroup ? area : undefined;
  const createGroupWiki =
    isBhagGroup && onCreateBhag
      ? () => onCreateBhag(label, items)
      : isAreaGroup && onCreateArea
        ? () => onCreateArea(label, items)
        : undefined;
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
    <HubGroup
      name={displayLabel}
      href={hierarchyEntity ? `/projects/${hierarchyEntity.slug}` : undefined}
      labelClassName={labelClass}
      icon={
        isBhagGroup ? (
          <Target className="h-4 w-4 shrink-0 text-primary" />
        ) : isAreaGroup ? (
          <Layers className="h-4 w-4 shrink-0 text-sky-500" />
        ) : undefined
      }
      count={items.length}
      /* Breadcrumb: show which BHAG this area belongs to */
      meta={
        isAreaGroup && parentBhagName ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs text-primary/70">
            <Target className="h-2.5 w-2.5" />
            {parentBhagName}
          </span>
        ) : undefined
      }
      /* Only on hover: promoting a group into a wiki of its own is a rare
         thing to do, and an offer standing permanently beside every group
         that lacks one is an offer made mostly to people who did not come
         to make it. */
      action={
        !hierarchyEntity && createGroupWiki
          ? {
              label: creating ? "Creating…" : "Create wiki",
              onClick: createGroupWiki,
              disabled: creating,
            }
          : undefined
      }
      className={cn(dragging && "scale-[0.995] bg-primary/5 opacity-60")}
      before={
        isBhagGroup && reordering ? (
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
        ) : undefined
      }
      overlay={
        <>
          {dropIndicatorPlacement === "before" && (
            <div className="absolute -top-1.5 left-0 right-0 h-0.5 rounded-full bg-primary" />
          )}
          {dropIndicatorPlacement === "after" && (
            <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded-full bg-primary" />
          )}
        </>
      }
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
      <div className="space-y-4">
        {isBhagGroup && childAreas && childAreas.length > 0 && (
          <HubGroupRun className="space-y-3">
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
          </HubGroupRun>
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
    </HubGroup>
  );
}

export function ProjectsHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [spaces, setSpaces] = useState<EnrichedProject[]>([]);
  const [bhags, setBhags] = useState<EnrichedProject[]>([]);
  const [areas, setAreas] = useState<EnrichedProject[]>([]);
  // Opened by this tab's own Add project, or by the ?onboard=1 link that
  // the welcome tour hands out.
  const [creating, setCreating] = useState(searchParams.get("onboard") === "1");
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
      setSpaces((projBody.data?.projects ?? []) as EnrichedProject[]);
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

  /**
   * The two axes, separated once.
   *
   * `/api/projects` answers with every space it holds, and a space sits on
   * either the hierarchy axis or the function one. A project and a subject
   * are different entities, so the catalogue and By function are handed
   * disjoint lists here rather than each filtering the same list its own way,
   * which is how one space ends up in both.
   */
  const { hierarchy: projects, subjects } = partitionSpaces(spaces);

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
                {/* Against the name, since what it reports is which TOME
                    this is. Outside the heading's own weight, so it stays a
                    mark beside the title rather than part of it. */}
                <TomeVersionNote className="self-center" />
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
                  className={cn(
                    HUB_CTA_CLASS,
                    "inline-flex items-center border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              )}
              {/* Beside the tour rather than down in the catalogue's
                  toolbar: connecting an agent is something you do to the
                  whole of TOME, not to the list of projects, and here it is
                  offered from every tab instead of only one. */}
              <McpConnectDialog initialOpen={searchParams.get("mcp") === "1"} />
              {/* Offered where a newcomer arrives, in the band that greets
                  them, and asking which walkthrough rather than assuming.
                  Every tour's first step is on the catalogue, so the tab is
                  set before one starts rather than leaving that step
                  pointing at a panel which is not showing. */}
              <TourMenu
                className={cn(
                  HUB_CTA_CLASS,
                  "border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary",
                )}
                onStart={() => setTab("projects")}
              />
              <TomeProductFeedback variant="link" />
            </div>
          </div>

        </div>
      </section>

      {/* Under the welcome rather than above the list, because they are three
          readings of the same thing and none of them is a section of the
          catalogue. Outside the band, so the band stays a greeting. */}
      <div className="flex justify-center">
        <HubTabs value={tab} onChange={setTab} settingsHref="/projects/admin" />
      </div>

      {isTomeAdmin && <OpenFgaModelRepairBanner />}

      {/* The overview is mounted only while it is open, because it fetches on
          mount and nothing it holds is worth keeping. The catalogue below is
          hidden instead: it carries a search, a grouping and a reorder mode a
          reader has set, over three requests, and dropping that to look at
          the digest for a moment would be a poor trade. */}
      {tab === "overview" && <WorkspaceOverview />}
      {tab === "digest" && <WorkspaceDigest />}
      {/* The subjects the hub already loaded, so moving between the two axes
          costs nothing. Not the catalogue's projects read another way: a
          subject is its own entity and appears here and nowhere else. */}
      {tab === "functions" && (
        <FunctionsView subjects={subjects} onSubjectCreated={() => void load()} />
      )}

      <section className={cn("space-y-6", tab !== "projects" && "hidden")}>
        <HubToolbar
          heading={
            <>
              <HubHeading>
                {loading
                  ? "Your projects"
                  : normalizedProjectQuery
                    ? `${filteredProjects.length} of ${projects.length} projects`
                    : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
              </HubHeading>
              <ActiveIngestsIndicator runs={activeIngests} />
            </>
          }
        >
          <HubSearchField
            value={projectQuery}
            onChange={setProjectQuery}
            placeholder="Find project…"
            label="Find a TOME project"
            clearLabel="Clear project search"
            anchor="hub-search"
          />
          {/* The same flow By function opens, carrying no placement: what
              differs between the two tabs is which axis the result lands on,
              not how it is made. */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            data-tour="hub-create"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add project
          </Button>
          {isTomeAdmin && groupBy === "initiative" && (
            <>
              <Button
                variant={reordering ? "secondary" : "outline"}
                size="sm"
                className="h-8 gap-1.5"
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
                  className="h-8 gap-1.5 text-muted-foreground"
                  disabled={orderSaving}
                  onClick={resetBhagOrder}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
              )}
            </>
          )}
        </HubToolbar>

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
      <SpaceCreationFlow
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => void load()}
      />

      <OnboardingModal open={onboardingOpen} onOpenChange={handleOnboardingChange} />
    </div>
  );
}
