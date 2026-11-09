"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowUpRight,
  BookA,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Plug,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  FolderKanban,
  FolderPlus,
  HelpCircle,
  Layers,
  LayoutTemplate,
  Link2,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquare,
  MessagesSquare,
  Minimize2,
  FileSymlink,
  Gauge,
  House,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  NotebookPen,
  Settings,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";

import { HeaderBreadcrumbPortal } from "@/components/layout/HeaderBreadcrumbSlot";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatPanel } from "@/components/tome/ChatPanel";
import { AskTomePlaceholder } from "@/components/tome/AskTomePlaceholder";
import { TomeAssistantBubble } from "@/components/tome/TomeAssistantBubble";
import { FeedPanel } from "@/components/tome/FeedPanel";
import { GistsPanel } from "@/components/tome/GistsPanel";
import { GistView } from "@/components/tome/GistView";
import { GlossaryView } from "@/components/tome/GlossaryView";
import { PanelShell } from "@/components/tome/PanelHeader";
import { SourcesIndex } from "@/components/tome/SourcesIndex";
import { TomeEmpty } from "@/components/tome/TomeEmpty";
import { NavCount, NavItem, NavSection } from "@/components/tome/RailNav";
import { TomeLoading } from "@/components/tome/TomeLoading";
import {
  RelatedSpacesBlock,
  RelatedSpacesRail,
} from "@/components/tome/RelatedSpaces";
import { TreeIndex } from "@/components/tome/TreeIndex";
import { ProjectSettingsPanel } from "@/components/tome/ProjectSettingsPanel";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { groupBySource, sourceById } from "@/lib/tome/sources";
import { isReferencePath, splitWikiTree } from "@/lib/tome/wiki-tree-split";
import { usePersistentDisclosure } from "@/lib/tome/use-persistent-disclosure";
import { useFeatureFlagStore } from "@/store/feature-flag-store";
import {
  ProjectDescription,
  ProjectMetadataInfo,
} from "@/components/tome/ProjectDescription";
import { OnboardingModal } from "@/components/tome/OnboardingModal";
import {
  WikiSidebar,
  type WikiNavigationItem,
  type WikiNavigationTarget,
} from "@/components/tome/WikiSidebar";
import { WikiPageView } from "@/components/tome/WikiPageView";
import { WikiContentManager } from "@/components/tome/WikiContentManager";
import { WikiExportMenu } from "@/components/tome/WikiExportMenu";
import type { GlossaryPreview } from "@/components/tome/CrepeEditor";
import { parseTomeHref } from "@/lib/tome/tome-links";
import { useTomeViewTracking } from "@/lib/tome/usage-tracking";
import { ReportsDisclosure } from "@/components/tome/ReportsDisclosure";
import { MeetingsView } from "@/components/tome/MeetingsView";
import { StandupView } from "@/components/tome/StandupView";
import { GithubIssuesPanel } from "@/components/tome/GithubIssuesPanel";
import { IssueLabelDisclosure } from "@/components/tome/IssueLabelDisclosure";
import { IssueLabelViewList } from "@/components/tome/IssueLabelViewList";
import { IngestPanel } from "@/components/tome/IngestPanel";
import { TemplatesPanel } from "@/components/tome/TemplatesPanel";
import { IngestRunView } from "@/components/tome/IngestRunView";
import { DraftReviewView } from "@/components/tome/DraftReviewView";
import { EngagementPanel } from "@/components/tome/EngagementPanel";
import { PageHistoryView } from "@/components/tome/PageHistoryView";
import { pageDisplayName } from "@/lib/tome/page-names";
import { Breadcrumb, type Crumb } from "@/components/tome/Breadcrumb";
import { McpConnectDialog } from "@/components/tome/McpConnectDialog";
import { FollowMenu } from "@/components/tome/FollowMenu";
import { isTourRunning } from "@/components/tour/notification-tour";
import { TomeProductFeedback } from "@/components/tome/TomeProductFeedback";
import type { AncestorRow } from "@/components/tome/home/HomePartOf";
import { ProjectHomeView } from "@/components/tome/home/ProjectHomeView";
import { ViewOnlyTooltip } from "@/components/tome/ViewOnlyTooltip";
import {
  DeleteFolderDialog,
  DeletePageDialog,
} from "@/components/tome/DeletePageDialog";
import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import {
  isSupportedTomeImportPath,
  TOME_IMPORT_ACCEPT,
} from "@/lib/tome/document-import-formats";
import { defaultGistFilename } from "@/lib/tome/gists";
import {
  findTomeTrackedIssueLabel,
  matchesTomeTrackedIssueLabel,
  TOME_TRACKED_ISSUE_LABELS,
  type TomeTrackedIssueLabel,
} from "@/lib/tome/issue-filter-views";
import { useResponsiveProjectSidebar } from "@/lib/tome/responsive-project-sidebar";
import { useElementFullscreen } from "@/lib/tome/use-element-fullscreen";
import { cn } from "@/lib/utils";
import { getProjectsNavigationLabel } from "@/lib/navigation-labels";
import { buildPageCreationAgentPrompt } from "@/lib/tome/page-creation";
import {
  DEFAULT_TOME_REPORT_VISIBILITY,
  resolveTomeReportVisibility,
} from "@/lib/tome/report-visibility";
import { useRelatedSpaces } from "@/hooks/use-related-spaces";
import { useTomeRailCounts } from "@/hooks/use-tome-rail-counts";
import { useWikiUnread } from "@/hooks/use-wiki-unread";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import type {
  PageNotifyOutcome,
  PageNotifySelection,
  PageTreeNode,
  TomeFolder,
} from "@/types/tome";
import {
  dataStewardLabel,
  isSynthesizedType,
  type ProjectDocument,
  type ProjectType,
  type TomeReportVisibility,
} from "@/types/projects";

interface PagesResponse {
  slug: string;
  tree: PageTreeNode[];
  pages: Record<string, string>;
  folders: Array<Pick<TomeFolder, "id" | "parent_id" | "name" | "source_path" | "order">>;
  canEdit: boolean;
  canManageSteward: boolean;
}

type FolderDialogState = {
  mode: "create" | "edit";
  folderId?: string;
  name: string;
  parentId: string | null;
};

/** An edge authored in another project, pointing at this one. */
interface IncomingEdge {
  source_project_slug: string;
  path: string;
  relation: string;
  source: string;
  target: string;
  confidence: string | null;
  status: string;
}

/** Browser-local flag so the first-run walkthrough only auto-opens once. */
const ONBOARDING_SEEN_KEY = "tome.onboarding.seen";

type MainView =
  | { kind: "summary" }
  | { kind: "agent" }
  | { kind: "standup" }
  | { kind: "meetings" }
  | { kind: "wiki" }
  | { kind: "glossary" }
  | { kind: "sources" }
  | { kind: "source"; id: string }
  | { kind: "related" }
  | { kind: "issues"; label?: string }
  | { kind: "feed" }
  | { kind: "gists" }
  | { kind: "newGist" }
  | { kind: "gist"; id: string }
  | { kind: "settings" }
  | { kind: "templates" }
  | { kind: "insights" }
  | { kind: "folder"; id: string }
  | { kind: "page"; path: string }
  | { kind: "pageHistory"; path: string }
  | { kind: "ingest" }
  | { kind: "ingestRun"; runId: string }
  | { kind: "draftReview"; runId: string };

/**
 * Map the active view to its URL segments under `/projects/<slug>/tome`. The
 * view lives in the route (not React state) so every surface is deep-linkable
 * and browser back/forward work. Wiki page paths (which contain `/` and `.md`)
 * are namespaced under `wiki/` / `history/` so they can't collide with the
 * reserved `feed` / `ingest` segments.
 */
function viewToPath(slug: string, view: MainView): string {
  const base = `/projects/${slug}/tome`;
  switch (view.kind) {
    case "summary":
      return base;
    case "agent":
      return `${base}/agent`;
    case "standup":
      return `${base}/standup`;
    case "meetings":
      return `${base}/meetings`;
    case "wiki":
      return `${base}/wiki`;
    case "glossary":
      return `${base}/glossary`;
    case "sources":
      return `${base}/sources`;
    case "source":
      return `${base}/sources/${encodeURIComponent(view.id)}`;
    case "related":
      return `${base}/related`;
    case "issues":
      return view.label
        ? `${base}/issues/label/${encodeURIComponent(view.label)}`
        : `${base}/issues`;
    case "feed":
      return `${base}/feed`;
    case "gists":
      return `${base}/gists`;
    case "newGist":
      return `${base}/gists/new`;
    case "gist":
      return `${base}/gists/${encodeURIComponent(view.id)}`;
    case "settings":
      return `${base}/settings`;
    case "templates":
      return `${base}/templates`;
    case "insights":
      return `${base}/insights`;
    case "folder":
      return `${base}/folders/${encodeURIComponent(view.id)}`;
    case "ingest":
      return `${base}/ingest`;
    case "ingestRun":
      return `${base}/ingest/${encodeURIComponent(view.runId)}`;
    case "draftReview":
      return `${base}/ingest/${encodeURIComponent(view.runId)}/review`;
    case "page":
      return `${base}/wiki/${view.path}`;
    case "pageHistory":
      return `${base}/history/${view.path}`;
  }
}

/** Parse the catch-all segments back into a view. Unknown shapes fall to the summary. */
function pathToView(segments: string[]): MainView {
  const [head, ...rest] = segments;
  switch (head) {
    case undefined:
      return { kind: "summary" };
    case "agent":
      return { kind: "agent" };
    case "standup":
      return { kind: "standup" };
    case "meetings":
      return { kind: "meetings" };
    case "glossary":
      // The branch is the vocabulary; a term below it is a page like any
      // other, and keeps its own path so a link written either way lands.
      return rest.length
        ? { kind: "page", path: segments.join("/") }
        : { kind: "glossary" };
    case "issues":
      return rest[0] === "label" && rest.length > 1
        ? { kind: "issues", label: rest.slice(1).join("/") }
        : { kind: "issues" };
    // Keep links from the earlier issue-panel routes working.
    case "critical-items":
    case "github-issues":
      return { kind: "issues" };
    case "feed":
      return { kind: "feed" };
    case "gists":
      return rest[0] === "new"
        ? { kind: "newGist" }
        : rest[0]
          ? { kind: "gist", id: rest[0] }
          : { kind: "gists" };
    case "settings":
      return { kind: "settings" };
    case "templates":
      return { kind: "templates" };
    case "insights":
      return { kind: "insights" };
    case "folders":
      return rest[0] ? { kind: "folder", id: rest[0] } : { kind: "summary" };
    case "ingest":
      return rest[0]
        ? rest[1] === "review"
          ? { kind: "draftReview", runId: rest[0] }
          : { kind: "ingestRun", runId: rest[0] }
        : { kind: "ingest" };
    case "wiki":
      return rest.length
        ? { kind: "page", path: rest.join("/") }
        : { kind: "wiki" };
    case "sources":
      return rest[0] ? { kind: "source", id: rest[0] } : { kind: "sources" };
    case "related":
    // The mirrored material moved to Sources and the section kept only the
    // spaces tagged alongside, but a link written against the old name still
    // has to land somewhere true.
    case "references":
      return { kind: "related" };
    case "history":
      return rest.length
        ? { kind: "pageHistory", path: rest.join("/") }
        : { kind: "summary" };
    default:
      return { kind: "summary" };
  }
}

function pageTitleOf(path: string, markdown: string): string {
  const [fm] = parseFrontmatter(markdown);
  return typeof fm.title === "string"
    ? fm.title
    : (SPEC_BY_PATH.get(path)?.title ?? pageDisplayName(path));
}

export function TomeWiki({ slug }: { slug: string }) {
  // The active view lives in the URL (deep-linkable, back/forward works), but we
  // navigate with `history.pushState` rather than `router.push` so this client
  // component never remounts — only the derived `view` changes, swapping the
  // main pane while the sidebar, breadcrumb, and loaded page tree persist. Next
  // syncs pushState into `usePathname`, so direct loads and popstate still work.
  const pathname = usePathname();
  const [assistantBottomInset, setAssistantBottomInset] = useState(24);
  const base = `/projects/${slug}/tome`;
  const {
    open: projectSidebarOpen,
    toggle: toggleProjectSidebar,
    close: closeProjectSidebar,
    closeOnCompact: closeProjectSidebarOnCompact,
  } = useResponsiveProjectSidebar();
  const segments = useMemo(() => {
    if (!pathname) return [];
    const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
    return rest.split("/").map(decodeURIComponent).filter(Boolean);
  }, [pathname, base]);
  // The active view is derived from the URL — Agent is the landing view.
  const view = useMemo(() => pathToView(segments), [segments]);
  const trackedPagePath =
    view.kind === "page" || view.kind === "pageHistory" ? view.path : undefined;
  const {
    hasUnsavedChanges,
    requestNavigation,
    requestDeferredAction,
  } = useUnsavedChangesStore();
  const navigate = useCallback(
    (next: MainView) => {
      closeProjectSidebarOnCompact();
      const url = viewToPath(slug, next);
      if (url === pathname) return;
      const action = () => window.history.pushState(null, "", url);
      if (view.kind === "settings" && hasUnsavedChanges) {
        requestDeferredAction(action);
        return;
      }
      action();
    },
    [
      slug,
      pathname,
      view.kind,
      hasUnsavedChanges,
      requestDeferredAction,
      closeProjectSidebarOnCompact,
    ],
  );
  const interceptHrefNavigation = useCallback((href: string): boolean => {
    if (view.kind !== "settings" || !hasUnsavedChanges) return false;
    requestNavigation(href);
    return true;
  }, [hasUnsavedChanges, requestNavigation, view.kind]);

  const [data, setData] = useState<PagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artifactPath, setArtifactPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [wikiQuery, setWikiQuery] = useState("");
  // Dots in the rail for pages the reader has not caught up on.
  const { unreadPaths, markPageRead } = useWikiUnread(slug);
  // First-run onboarding: project title (for the modal copy) + open state.
  const [projectTitle, setProjectTitle] = useState<string | null>(null);
  const [projectMeta, setProjectMeta] = useState<{
    description: string | null;
    status: string | null;
    teamName: string | null;
    tags: string[];
    dataSteward: string | null;
    /** Kept whole for Home's Sources card, which reads it as Ingest does. */
    sources: Record<string, unknown> | null;
  }>({
    description: null,
    status: null,
    teamName: null,
    tags: [],
    dataSteward: null,
    sources: null,
  });
  const [projectMetaLoading, setProjectMetaLoading] = useState(true);
  const [reportVisibility, setReportVisibility] = useState<TomeReportVisibility>(
    DEFAULT_TOME_REPORT_VISIBILITY,
  );
  // BHAG/Area awareness: this project's kind, the initiatives it's tagged
  // with, and the BHAG entities those initiatives resolve to (for the up-link
  // chip).
  const [projectType, setProjectType] = useState<ProjectType>("project");
  const [initiatives, setInitiatives] = useState<string[]>([]);
  const [areaTags, setAreaTags] = useState<string[]>([]);
  const [parentBhags, setParentBhags] = useState<{ slug: string; name?: string; title?: string }[]>([]);
  const [parentAreas, setParentAreas] = useState<
    { slug: string; name?: string; title?: string; parentBhagSlug?: string }[]
  >([]);
  // Every BHAG entity (fetched once, unconditionally, for both this project's
  // direct BHAG tags AND resolving an Area's transitive parent BHAG below).
  const [allBhags, setAllBhags] = useState<{ slug: string; name: string }[]>([]);
  const isBhag = projectType === "bhag";
  const isArea = projectType === "area";
  const isSynthesized = isSynthesizedType(projectType);
  const canEdit = data?.canEdit ?? false;
  const [canRemoveIssueTrackers, setCanRemoveIssueTrackers] = useState(false);
  const [issueTrackers, setIssueTrackers] = useState<TomeTrackedIssueLabel[]>(
    TOME_TRACKED_ISSUE_LABELS,
  );
  const [trackerDialogOpen, setTrackerDialogOpen] = useState(false);
  const [trackerSuffix, setTrackerSuffix] = useState("");
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [trackerRemovalError, setTrackerRemovalError] = useState<string | null>(null);
  const [creatingTracker, setCreatingTracker] = useState(false);
  const [removingTracker, setRemovingTracker] = useState<string | null>(null);
  const duplicateIssueTracker = useMemo(() => {
    return findTomeTrackedIssueLabel(issueTrackers, trackerSuffix);
  }, [issueTrackers, trackerSuffix]);
  const activeTrackedIssueLabel = useMemo(() => {
    if (view.kind !== "issues" || !view.label) return undefined;
    return issueTrackers.find(
      (tracked) => matchesTomeTrackedIssueLabel([view.label], tracked),
    );
  }, [issueTrackers, view]);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/tome/projects/${encodeURIComponent(slug)}/issue-trackers`)
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(body?.data?.trackers)) return;
        if (!cancelled) {
          setIssueTrackers(body.data.trackers);
          setCanRemoveIssueTrackers(body.data.can_remove === true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const createIssueTracker = useCallback(async () => {
    const suffix = trackerSuffix.trim();
    if (!suffix || duplicateIssueTracker) return;
    setCreatingTracker(true);
    setTrackerError(null);
    try {
      const response = await fetch(
        `/api/tome/projects/${encodeURIComponent(slug)}/issue-trackers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suffix }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.data?.trackers)) {
        throw new Error(body?.error ?? "Could not create tracked label");
      }
      setIssueTrackers(body.data.trackers);
      setTrackerSuffix("");
      setTrackerDialogOpen(false);
    } catch (createError) {
      setTrackerError(
        createError instanceof Error
          ? createError.message
          : "Could not create tracked label",
      );
    } finally {
      setCreatingTracker(false);
    }
  }, [duplicateIssueTracker, slug, trackerSuffix]);

  const removeIssueTracker = useCallback(async (tracked: TomeTrackedIssueLabel) => {
    if (removingTracker) return;
    setRemovingTracker(tracked.label);
    setTrackerRemovalError(null);
    try {
      const response = await fetch(
        `/api/tome/projects/${encodeURIComponent(slug)}/issue-trackers`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: tracked.label }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.data?.trackers)) {
        throw new Error(body?.error ?? "Could not remove tracked label");
      }
      setIssueTrackers(body.data.trackers);
      if (view.kind === "issues" && view.label && matchesTomeTrackedIssueLabel([view.label], tracked)) {
        navigate({ kind: "issues" });
      }
    } catch (removeError) {
      setTrackerRemovalError(
        removeError instanceof Error ? removeError.message : "Could not remove tracked label",
      );
    } finally {
      setRemovingTracker(null);
    }
  }, [navigate, removingTracker, slug, view]);
  // For a BHAG/Area: its own name (the label children are tagged with) and
  // the child projects that resolve from it — surfaced as down-links in the nav.
  const [projectName, setProjectName] = useState("");
  const [childProjects, setChildProjects] = useState<{ slug: string; title: string }[]>([]);
  // A BHAG's down-links, split like ProjectsHub: Areas tagged to it (their own
  // nested project counts) and skip-level projects tagged directly (no area).
  const [childAreas, setChildAreas] = useState<
    { slug: string; title: string; projectCount: number }[]
  >([]);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  // "New page" dialog + hidden file picker for the Wiki rail action cluster.
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [newPageParentFolder, setNewPageParentFolder] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [autoEditPath, setAutoEditPath] = useState<string | null>(null);
  const [agentPrefill, setAgentPrefill] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [savingFolder, setSavingFolder] = useState(false);
  const [pagePendingDelete, setPagePendingDelete] = useState<string | null>(null);
  const [deletingPage, setDeletingPage] = useState(false);
  const [folderPendingDelete, setFolderPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [importing, setImporting] = useState(false);
  const newPageInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  // Full-screen: the browser Fullscreen API on the wiki root (below AppHeader)
  // hides the outer app chrome while keeping the wiki's own sidebar/header.
  const wikiRootRef = useRef<HTMLDivElement | null>(null);
  const { isFallbackFullscreen, isFullscreen, toggleFullscreen } =
    useElementFullscreen(wikiRootRef);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/pages`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const json = await res.json();
      setData(json?.data as PagesResponse);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pick up out-of-band page changes (MCP edits, another tab/user, a
  // revert) without a manual refresh: refetch on tab focus, plus a slow
  // background poll while the tab is visible. Safe to call while a page is
  // mid-edit — WikiPageView only applies a fresh `markdown` prop when the
  // user isn't actively editing (see its `editorEpoch` effect).
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [load]);

  // Locked = an ingest is in flight. Derived from the same ingest-run signal
  // the ingest panel polls (no extra project fetch). Drives the editor's
  // read-only banner. On the running→idle transition, reload pages so the
  // agent's fresh rewrite shows without a manual refresh.
  const [locked, setLocked] = useState(false);
  const [awaitingReview, setAwaitingReview] = useState(false);
  const prevLockedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/tome/projects/${slug}/ingests`);
        if (!res.ok) return;
        const json = await res.json();
        const runs = (json?.data?.runs ?? []) as Array<{ status?: string }>;
        const reviewing = runs.some((r) => r.status === "awaiting_review");
        const active =
          reviewing || runs.some((r) => r.status === "running" || r.status === "queued");
        if (cancelled) return;
        if (prevLockedRef.current && !active) void load();
        prevLockedRef.current = active;
        setLocked(active);
        setAwaitingReview(reviewing);
      } catch {
        /* best-effort — leave the last known state */
      }
    };
    void check();
    const t = setInterval(check, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [slug, load]);

  // Applies a fresh project doc to every piece of state the breadcrumb,
  // hierarchy chips, and sidebar down-links derive from. Shared by the
  // initial load and the Settings panel's onSaved (its PATCH response
  // already carries the fresh project — no need to refetch just to pick up
  // a title/hierarchy change).
  const applyProjectMeta = useCallback((p: Partial<ProjectDocument> | null | undefined) => {
    if (!p) return;
    if (typeof p.title === "string" && p.title) setProjectTitle(p.title);
    setProjectName(p.slug);
    setProjectType(p.type ?? "project");
    setInitiatives(Array.isArray(p.labels?.initiatives) ? p.labels.initiatives : []);
    setAreaTags(Array.isArray(p.labels?.areas) ? p.labels.areas : []);
    setReportVisibility(resolveTomeReportVisibility(p));
    setProjectMeta({
      description: typeof p.description === "string" ? p.description : null,
      status: typeof p.status === "string" ? p.status : null,
      teamName: typeof p.team_name === "string" ? p.team_name : null,
      tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string") : [],
      dataSteward: dataStewardLabel(p.data_steward) || null,
      sources: (p.sources as Record<string, unknown> | undefined) ?? null,
    });
  }, []);

  // Project title (onboarding modal copy) + BHAG awareness (kind + the
  // initiatives this project is tagged with).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${slug}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        applyProjectMeta(body?.data?.project);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setProjectMetaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, applyProjectMeta]);

  const showStandupReport = reportVisibility.enabled && reportVisibility.standup;
  const showIssuesReport = reportVisibility.enabled && reportVisibility.issues;
  const showReports = showStandupReport || showIssuesReport;

  useEffect(() => {
    if (projectMetaLoading) return;
    if (
      (view.kind === "standup" && !showStandupReport)
      || (view.kind === "issues" && !showIssuesReport)
    ) {
      navigate({ kind: "summary" });
    }
  }, [navigate, projectMetaLoading, showIssuesReport, showStandupReport, view.kind]);

  // Fetch every BHAG entity once (unconditionally, unless this page IS a
  // BHAG) — used both to resolve this project's direct BHAG tags below and,
  // further down, to resolve an Area's transitive parent BHAG.
  useEffect(() => {
    if (isBhag) {
      setAllBhags([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?type=bhag`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setAllBhags((body?.data?.projects ?? []) as { slug: string; name: string }[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, isBhag]);

  const bhagByLabelAll = useMemo(
    () => new Map(allBhags.map((b) => [b.slug, b])),
    [allBhags],
  );

  // Resolve this project's initiative tags to BHAG entities so a regular
  // project — or an Area, which tags its own parent BHAG the same way —
  // can surface a clickable up-link to its strategic goal(s). Only a true
  // BHAG has no parent to resolve; an Area's `initiatives` tag IS its
  // parent BHAG and must still resolve here.
  useEffect(() => {
    if (isBhag || initiatives.length === 0) {
      setParentBhags([]);
      return;
    }
    const want = new Set(initiatives);
    setParentBhags(allBhags.filter((b) => want.has(b.slug)));
  }, [isBhag, initiatives, allBhags]);

  // Resolve this project's area tags to Area entities, mirroring the BHAG
  // up-link above (sky-blue chip instead of the primary-colored BHAG one). A
  // BHAG itself skips this (no parent), but an Area still tags a parent BHAG
  // via the up-link above, not this one. Carries the Area's own parent-BHAG
  // name (its `labels.initiatives[0]`) so a project that ONLY tags an Area —
  // never the BHAG directly — can still show a transitive BHAG chip below.
  useEffect(() => {
    if (isBhag || areaTags.length === 0) {
      setParentAreas([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?type=area`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const all = (body?.data?.projects ?? []) as {
          slug: string;
          title?: string;
          name?: string;
          labels?: { initiatives?: string[] };
        }[];
        const want = new Set(areaTags);
        setParentAreas(
          all
            .filter((a) => want.has(a.slug))
            .map((a) => ({ slug: a.slug, name: a.title ?? a.name ?? a.slug, parentBhagSlug: a.labels?.initiatives?.[0] })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, isBhag, areaTags]);

  // BHAGs inherited transitively via an Area tag — only for BHAGs this
  // project doesn't ALSO tag directly (avoids a duplicate chip for legacy
  // data that tags both). Rendered as a distinct "via Area" chip below.
  const transitiveBhags = useMemo(() => {
    const directSlugs = new Set(initiatives);
    const seen = new Set<string>();
    const out: { slug: string; name?: string; title?: string; viaAreaName: string }[] = [];
    for (const a of parentAreas) {
      if (!a.parentBhagSlug) continue;
      if (directSlugs.has(a.parentBhagSlug) || seen.has(a.parentBhagSlug)) continue;
      const b = bhagByLabelAll.get(a.parentBhagSlug);
      if (b) {
        out.push({ ...b, viaAreaName: a.title ?? a.name ?? a.slug });
        seen.add(a.parentBhagSlug);
      }
    }
    return out;
  }, [parentAreas, initiatives, bhagByLabelAll]);

  // For a BHAG/Area, resolve the projects tagged to it so the nav can list
  // them as down-links. A BHAG's children tag it via `labels.initiatives`
  // (`?initiative=`); an Area's children tag it via `labels.areas`
  // (`?area=`) — mirrors the child-resolution split in `lib/tome/bhag.ts`.
  useEffect(() => {
    if (!isSynthesized || !projectName) {
      setChildProjects([]);
      return;
    }
    let cancelled = false;
    const param = isArea ? "area" : "initiative";
    fetch(`/api/projects?${param}=${encodeURIComponent(projectName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const kids = (body?.data?.projects ?? []) as {
          slug: string;
          title?: string;
          name?: string;
          labels?: { areas?: string[] };
        }[];
        // A BHAG's direct-child list must exclude projects also tagged to
        // one of its child Areas — those already appear nested under that
        // Area below (`childAreas`), mirroring ProjectsHub's `splitByArea`.
        // An Area has no further nesting, so its own children pass through
        // unfiltered.
        const skipLevel = isArea
          ? kids
          : kids.filter((k) => (k.labels?.areas ?? []).length === 0);
        setChildProjects(
          skipLevel.map((k) => ({ slug: k.slug, title: k.title || k.name || k.slug })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isSynthesized, isArea, projectName]);

  // For a BHAG specifically, also resolve the Areas tagged to it (via
  // `labels.initiatives`), each with its own tagged-project count, so the
  // down-links split into Areas + "tagged directly" skip-level projects —
  // mirroring ProjectsHub's nested BHAG → Area → Project view.
  useEffect(() => {
    if (!isBhag || !projectName) {
      setChildAreas([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?type=area&initiative=${encodeURIComponent(projectName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(async (body) => {
        if (cancelled) return;
        const areaList = (body?.data?.projects ?? []) as { slug: string; name: string; title?: string }[];
        const withCounts = await Promise.all(
          areaList.map(async (a) => {
            try {
              const r = await fetch(`/api/projects?area=${encodeURIComponent(a.slug)}`);
              const b = r.ok ? await r.json() : null;
              const count = Array.isArray(b?.data?.projects) ? b.data.projects.length : 0;
              return { slug: a.slug, title: a.title || a.name, projectCount: count };
            } catch {
              return { slug: a.slug, title: a.title || a.name, projectCount: 0 };
            }
          }),
        );
        if (!cancelled) setChildAreas(withCounts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isBhag, projectName]);

  // Edges authored in OTHER projects that target this one — the
  // backlink half; outgoing edges are ordinary pages under this project's own
  // `edges/` dir and already show in the tree above.
  const [incomingEdges, setIncomingEdges] = useState<IncomingEdge[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tome/projects/${slug}/edges`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setIncomingEdges((body?.data?.incoming ?? []) as IncomingEdge[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Show the first-run walkthrough once per browser. The TOME home help button reopens it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Not over a walkthrough in progress: it brings the reader here itself,
    // and a dialog on arrival would cover the step they are reading.
    if (isTourRunning()) return;
    if (!window.localStorage.getItem(ONBOARDING_SEEN_KEY)) {
      setOnboardingOpen(true);
    }
  }, []);

  const handleOnboardingChange = useCallback((open: boolean) => {
    setOnboardingOpen(open);
    if (!open && typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    }
  }, []);

  const openPage = useCallback(
    (path: string) => {
      // Opening the page is what "I have seen this" means here, so the dot
      // clears on navigation rather than waiting for the inbox.
      markPageRead(path);
      navigate({ kind: "page", path });
    },
    [markPageRead, navigate],
  );
  const openFolder = useCallback(
    (id: string) => navigate({ kind: "folder", id }),
    [navigate],
  );
  const openArtifact = useCallback((path: string) => setArtifactPath(path), []);

  // Resolve a glossary reference to its definition for the hover card. A
  // same-project (bare) term is already loaded in `data.pages` and resolves
  // from memory; a cross-project `tome://@<project>/glossary/<slug>` ref goes
  // through the resolver endpoint.
  const glossaryPreview = useCallback(
    async (ref: string): Promise<GlossaryPreview | null> => {
      const target = parseTomeHref(ref);
      if (!target?.glossaryTerm) return null;

      // Same-project (bare): every page is loaded, so a miss is *definitively*
      // unresolved (return null → dangling). No fetch needed.
      if (!target.project) {
        const md = data?.pages[`glossary/${target.glossaryTerm}.md`];
        if (md === undefined) return null;
        const [fm, bodyRaw] = parseFrontmatter(md);
        const termStr = String(fm.term ?? fm.title ?? target.glossaryTerm);
        const expansion =
          typeof fm.expansion === "string" && fm.expansion.trim()
            ? fm.expansion.trim()
            : undefined;
        const definition = bodyRaw.replace(/^#.*$/m, "").trim().slice(0, 400);
        return { term: termStr, expansion, definition };
      }

      // Cross-project: a non-ok response is transient — throw so the caller
      // leaves the link unmarked. A resolved not-found returns null (dangling).
      const res = await fetch(
        `/api/tome/projects/${slug}/resolve?ref=${encodeURIComponent(ref)}`,
      );
      if (!res.ok) throw new Error(`resolve failed (${res.status})`);
      const d = (await res.json())?.data;
      if (d?.kind === "glossary" && d.found) {
        return {
          term: d.term ?? target.glossaryTerm,
          expansion: d.expansion,
          definition: d.definition ?? "",
        };
      }
      return null;
    },
    [data, slug],
  );

  const loading = data === null && !error;
  useTomeViewTracking(slug, view.kind, trackedPagePath, Boolean(data && !error &&
    (view.kind !== "page" || data.pages[view.path] !== undefined)));
  const isEmpty = data !== null && Object.keys(data.pages).length === 0 && data.tree.length === 0;
  const knownPagePaths = useMemo(
    () => new Set(Object.keys(data?.pages ?? {})),
    [data?.pages],
  );
  const folderParentOptions = useMemo(() => {
    const folders = data?.folders ?? [];
    const excluded = new Set<string>();
    if (folderDialog?.folderId) {
      excluded.add(folderDialog.folderId);
      let changed = true;
      while (changed) {
        changed = false;
        for (const folder of folders) {
          if (folder.parent_id && excluded.has(folder.parent_id) && !excluded.has(folder.id)) {
            excluded.add(folder.id);
            changed = true;
          }
        }
      }
    }
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return folders
      .filter((folder) => !excluded.has(folder.id))
      .map((folder) => {
        const names = [folder.name];
        let parentId = folder.parent_id;
        const visited = new Set([folder.id]);
        while (parentId && !visited.has(parentId)) {
          visited.add(parentId);
          const parent = byId.get(parentId);
          if (!parent) break;
          names.unshift(parent.name);
          parentId = parent.parent_id;
        }
        return { id: folder.id, label: names.join(" / ") };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [data?.folders, folderDialog?.folderId]);
  const filteredWikiTree = useMemo(() => {
    const query = wikiQuery.trim().toLocaleLowerCase();
    if (!query) return data?.tree ?? [];
    const filterNodes = (nodes: PageTreeNode[]): PageTreeNode[] => nodes.flatMap((node) => {
      if (`${node.title} ${node.path}`.toLocaleLowerCase().includes(query)) return [node];
      const children = filterNodes(node.children);
      return children.length > 0 ? [{ ...node, children }] : [];
    });
    return filterNodes(data?.tree ?? []);
  }, [data?.tree, wikiQuery]);
  const activeFolderNode = useMemo(() => {
    if (view.kind !== "folder") return null;
    const findFolder = (nodes: PageTreeNode[]): PageTreeNode | null => {
      for (const node of nodes) {
        if (node.folderId === view.id) return node;
        const match = findFolder(node.children);
        if (match) return match;
      }
      return null;
    };
    return findFolder(data?.tree ?? []);
  }, [data?.tree, view]);

  const writeMarkdown = useCallback(
    async (
      path: string,
      markdown: string,
      message: string,
      options?: {
        baseRevisionId?: string | null;
        force?: boolean;
        notify?: PageNotifySelection;
      },
    ) => {
      const res = await fetch(`/api/tome/projects/${slug}/pages/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown,
          message,
          base_revision_id: options?.baseRevisionId,
          force: options?.force,
          notify: options?.notify,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        if (res.status === 409 && payload?.code === "PAGE_EDIT_CONFLICT") {
          const conflict = new Error(payload.error) as Error & {
            code: string;
            currentRevisionId: string | null;
            currentMarkdown: string;
            currentAuthor: string | null;
            currentCreatedAt: string | null;
          };
          conflict.code = payload.code;
          conflict.currentRevisionId = payload.data?.current_revision_id ?? null;
          conflict.currentMarkdown = payload.data?.current_markdown ?? "";
          conflict.currentAuthor = payload.data?.current_author ?? null;
          conflict.currentCreatedAt = payload.data?.current_created_at ?? null;
          throw conflict;
        }
        const detail = typeof payload?.error === "string"
          ? payload.error
          : `save failed (${res.status})`;
        const code = typeof payload?.code === "string" ? ` [${payload.code}]` : "";
        throw new Error(`${detail}${code}`);
      }
      setData((prev) =>
        prev ? { ...prev, pages: { ...prev.pages, [path]: markdown } } : prev,
      );
      const payload = await res.json().catch(() => null);
      return (payload?.data?.notify ?? null) as PageNotifyOutcome | null;
    },
    [slug],
  );

  // Create a page from a (possibly nested) path. Adds .md if no extension,
  // seeds an H1 from the leaf name, then opens it. Backed by PUT /pages.
  const createPage = useCallback(
    async (
      rawPath: string,
      options: { parentFolderId?: string | null; openEditor?: boolean } = {},
    ) => {
      let path = rawPath.trim().replace(/^\/+/, "");
      if (!path) return;
      if (!/\.(md|mdx)$/i.test(path)) path += ".md";
      if (data?.pages[path] !== undefined) {
        if (options.openEditor) setAutoEditPath(path);
        openPage(path);
        return;
      }
      const leaf = path.replace(/\.(md|mdx)$/i, "").split("/").pop() ?? path;
      try {
        await writeMarkdown(path, `# ${leaf}\n`, `create ${path}`);
        if (options.parentFolderId) {
          const moveResponse = await fetch(
            `/api/tome/projects/${encodeURIComponent(slug)}/navigation`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                item: { kind: "page", id: path },
                target: {
                  position: "inside",
                  item: { kind: "folder", id: options.parentFolderId },
                },
              }),
            },
          );
          const moveBody = await moveResponse.json().catch(() => null);
          if (!moveResponse.ok) {
            setError(moveBody?.error ?? `Page placement failed (${moveResponse.status})`);
          }
        }
        await load();
        if (options.openEditor) setAutoEditPath(path);
        openPage(path);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [data, load, openPage, slug, writeMarkdown],
  );

  const openNewPage = useCallback((folder?: PageTreeNode) => {
    setNewPageParentFolder(
      folder?.folderId ? { id: folder.folderId, title: folder.title } : null,
    );
    setNewPageName("");
    setNewPageOpen(true);
  }, []);

  const promptAgentForPage = useCallback((rawPath: string) => {
    if (!rawPath.trim()) return;
    setAgentPrefill(buildPageCreationAgentPrompt({
      projectSlug: slug,
      rawPath,
      folderId: newPageParentFolder?.id,
      folders: data?.folders ?? [],
    }));
    setNewPageOpen(false);
    setNewPageName("");
    setNewPageParentFolder(null);
    navigate({ kind: "agent" });
  }, [data?.folders, navigate, newPageParentFolder, slug]);

  const openNewGist = useCallback((rawTitle: string) => {
    const title = rawTitle.trim();
    if (!title) return;
    const storageKey = `tome:gist-draft:${slug}:new`;
    let existing: {
      title?: unknown;
      filename?: unknown;
      body?: unknown;
      tags?: unknown;
    } = {};
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) existing = JSON.parse(stored) as typeof existing;
    } catch {
      // Replace an unreadable browser draft with a valid name-first draft.
    }

    const previousTitle = typeof existing.title === "string" ? existing.title : "";
    const previousFilename = typeof existing.filename === "string" ? existing.filename : "";
    const filenameWasCustomized = Boolean(
      previousFilename && previousFilename !== defaultGistFilename(previousTitle),
    );
    const updatedAt = new Date().toISOString();
    window.localStorage.setItem(storageKey, JSON.stringify({
      title,
      filename: filenameWasCustomized ? previousFilename : defaultGistFilename(title),
      body: typeof existing.body === "string" ? existing.body : "",
      tags: Array.isArray(existing.tags) ? existing.tags : [],
      updatedAt,
    }));
    navigate({ kind: "newGist" });
  }, [navigate, slug]);

  const deletePage = useCallback((path: string) => {
    setPagePendingDelete(path);
  }, []);

  const confirmDeletePage = useCallback(async () => {
    if (!pagePendingDelete || deletingPage) return;
    const path = pagePendingDelete;
    setDeletingPage(true);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/pages/${path}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      // Leave any view that was showing the now-deleted page.
      if (
        (view.kind === "page" || view.kind === "pageHistory") &&
        view.path === path
      ) {
        navigate({ kind: "summary" });
      }
      setArtifactPath((currentPath) => (currentPath === path ? null : currentPath));
      setPagePendingDelete(null);
      await load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setDeletingPage(false);
    }
  }, [deletingPage, load, navigate, pagePendingDelete, slug, view]);

  const openCreateFolder = useCallback((parentId: string | null = null) => {
    setFolderError(null);
    setFolderDialog({ mode: "create", name: "", parentId });
  }, []);

  const openEditFolder = useCallback((node: PageTreeNode) => {
    if (!node.folderId) return;
    setFolderError(null);
    setFolderDialog({
      mode: "edit",
      folderId: node.folderId,
      name: node.title,
      parentId: node.parentFolderId ?? null,
    });
  }, []);

  const saveFolder = useCallback(async () => {
    if (!folderDialog || !folderDialog.name.trim()) return;
    setSavingFolder(true);
    setFolderError(null);
    try {
      const editing = folderDialog.mode === "edit" && Boolean(folderDialog.folderId);
      const url = editing
        ? `/api/tome/projects/${encodeURIComponent(slug)}/folders/${encodeURIComponent(folderDialog.folderId!)}`
        : `/api/tome/projects/${encodeURIComponent(slug)}/folders`;
      const response = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: folderDialog.name.trim(),
          parent_id: folderDialog.parentId,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `Folder save failed (${response.status})`);
      setFolderDialog(null);
      await load();
    } catch (saveError) {
      setFolderError(saveError instanceof Error ? saveError.message : "Could not save folder");
    } finally {
      setSavingFolder(false);
    }
  }, [folderDialog, load, slug]);

  const deleteWikiFolder = useCallback((folderId: string) => {
    const folder = data?.folders.find((candidate) => candidate.id === folderId);
    if (!folder) return;
    setFolderPendingDelete({ id: folder.id, name: folder.name });
  }, [data?.folders]);

  const confirmDeleteWikiFolder = useCallback(async () => {
    if (!folderPendingDelete || deletingFolder) return;
    const folder = folderPendingDelete;
    setDeletingFolder(true);
    try {
      const response = await fetch(
        `/api/tome/projects/${encodeURIComponent(slug)}/folders/${encodeURIComponent(folder.id)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `Folder delete failed (${response.status})`);
      if (view.kind === "folder" && view.id === folder.id) navigate({ kind: "summary" });
      setFolderPendingDelete(null);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete folder");
    } finally {
      setDeletingFolder(false);
    }
  }, [deletingFolder, folderPendingDelete, load, navigate, slug, view]);

  const moveWikiItem = useCallback(async (
    item: WikiNavigationItem,
    target: WikiNavigationTarget,
  ) => {
    setError(null);
    try {
      const response = await fetch(
        `/api/tome/projects/${encodeURIComponent(slug)}/navigation`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item, target }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? `Move failed (${response.status})`);
      }
      await load();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not move item");
    }
  }, [load, slug]);

  /**
   * Pages and folders ticked in the settings tree.
   *
   * Kept by path, which is the one identifier a page and a folder share, so
   * the set can hold a mixed selection without a tagged union for the sake
   * of two bulk actions.
   */
  const [checkedPaths, setCheckedPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleChecked = useCallback((path: string, checked: boolean) => {
    setCheckedPaths((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);
  const clearChecked = useCallback(() => setCheckedPaths(new Set()), []);

  /**
   * What a ticked path turns out to be.
   *
   * The tree is the only thing that knows, and the two endpoints below need
   * to know: a folder is deleted by its id through one route and a page by
   * its path through another.
   */
  const checkedNodes = useMemo(() => {
    const found: PageTreeNode[] = [];
    const walk = (nodes: readonly PageTreeNode[]) => {
      for (const node of nodes) {
        if (checkedPaths.has(node.path)) found.push(node);
        walk(node.children);
      }
    };
    // The whole tree, not the filtered one: a tick made before a search was
    // typed is still a tick, and silently dropping it would delete less than
    // the count beside the button promised.
    walk(data?.tree ?? []);
    return found;
  }, [checkedPaths, data?.tree]);

  /**
   * Delete everything ticked, then read the tree back once.
   *
   * Sequential rather than parallel: deleting a folder renumbers what is left
   * beside it, and a page inside a folder being deleted in the same breath
   * would otherwise race its own parent.
   */
  const bulkDeleteChecked = useCallback(async () => {
    if (bulkBusy || checkedNodes.length === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      for (const node of checkedNodes) {
        const response =
          node.kind === "folder" && node.folderId
            ? await fetch(
                `/api/tome/projects/${encodeURIComponent(slug)}/folders/${encodeURIComponent(node.folderId)}`,
                { method: "DELETE" },
              )
            : await fetch(
                `/api/tome/projects/${encodeURIComponent(slug)}/pages/${node.path}`,
                { method: "DELETE" },
              );
        if (!response.ok) {
          throw new Error(`Could not delete ${node.title} (${response.status})`);
        }
        // Do not strand the reader on a page that no longer exists.
        if (
          (view.kind === "page" || view.kind === "pageHistory") &&
          view.path === node.path
        ) {
          navigate({ kind: "summary" });
        }
      }
      clearChecked();
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Could not delete",
      );
      // Whatever survived is still ticked, so a retry is one click rather
      // than a second pass through the tree.
      await load();
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, checkedNodes, clearChecked, load, navigate, slug, view]);

  /** Move everything ticked into one folder, or out to the root. */
  const bulkMoveChecked = useCallback(
    async (folderId: string | null) => {
      if (bulkBusy || checkedNodes.length === 0) return;
      setBulkBusy(true);
      setError(null);
      try {
        for (const node of checkedNodes) {
          // A folder cannot be moved into itself.
          if (node.kind === "folder" && node.folderId === folderId) continue;
          const response = await fetch(
            `/api/tome/projects/${encodeURIComponent(slug)}/navigation`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                item: {
                  kind: node.kind === "folder" ? "folder" : "page",
                  id: node.kind === "folder" ? node.folderId : node.path,
                },
                target: folderId
                  ? { position: "inside", item: { kind: "folder", id: folderId } }
                  : { position: "root" },
              }),
            },
          );
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error ?? `Could not move ${node.title}`);
          }
        }
        clearChecked();
        await load();
      } catch (moveError) {
        setError(
          moveError instanceof Error ? moveError.message : "Could not move",
        );
        await load();
      } finally {
        setBulkBusy(false);
      }
    },
    [bulkBusy, checkedNodes, clearChecked, load, slug],
  );

  // Rename a page: write its markdown to the new path, then tombstone the old
  // one (there's no move endpoint). History starts fresh on the new path.
  const renamePage = useCallback(
    async (oldPath: string, rawNew: string) => {
      let next = rawNew.trim().replace(/^\/+/, "");
      if (!next) return;
      if (!/\.(md|mdx)$/i.test(next)) next += ".md";
      if (next === oldPath) return;
      if (data?.pages[next] !== undefined) {
        throw new Error(`A page already exists at ${next}`);
      }
      const md = data?.pages[oldPath];
      if (md === undefined) throw new Error("Page not found");
      await writeMarkdown(next, md, `rename ${oldPath} to ${next}`);
      const res = await fetch(`/api/tome/projects/${slug}/pages/${oldPath}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`rename failed to remove old page (${res.status})`);
      await load();
      if (view.kind === "page" && view.path === oldPath) {
        navigate({ kind: "page", path: next });
      }
      setArtifactPath((p) => (p === oldPath ? next : p));
    },
    [data, slug, writeMarkdown, load, navigate, view],
  );

  // Import supported documents through the server converter. Nested layout is
  // preserved via webkitRelativePath when a folder is selected/dropped.
  const uploadPages = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const unsupported = list.filter((file) => {
        const sourcePath =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        return !isSupportedTomeImportPath(sourcePath);
      });
      if (list.length === 0 || unsupported.length > 0) {
        setError("Choose Markdown, text, HTML, DOCX, or PDF files to import.");
        return;
      }
      setImporting(true);
      setError(null);
      try {
        const form = new FormData();
        for (const f of list) {
          const rel =
            (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
            f.name;
          form.append("files", f, f.name);
          form.append("paths", rel.replace(/^\/+/, ""));
        }
        const res = await fetch(`/api/tome/projects/${slug}/import`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            (typeof body?.error === "string" ? body.error : body?.error?.message) ||
              body?.message ||
              `import failed (${res.status})`,
          );
        }
        await load();
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setImporting(false);
      }
    },
    [slug, load],
  );

  const crumbs = useMemo<Crumb[]>(() => {
    switch (view.kind) {
      // The summary is the entity's landing view, so the entity crumb already
      // names it — a crumb for the summary would just repeat the position.
      case "summary":
        return [];
      case "agent":
        return [{ label: "Agent" }];
      case "standup":
        return [{ label: "Standup" }];
      case "meetings":
        return [{ label: "Meetings" }];
      case "wiki":
        return [{ label: "Wiki" }];
      case "glossary":
        return [
          { label: "Wiki", onClick: () => navigate({ kind: "wiki" }) },
          { label: "Glossary" },
        ];
      case "related":
        return [{ label: "Related projects" }];
      case "sources":
        return [{ label: "Sources" }];
      case "source":
        return [
          { label: "Sources", onClick: () => navigate({ kind: "sources" }) },
          { label: sourceById(view.id)?.name ?? view.id },
        ];
      case "issues": {
        // Under GitHub, which is where the issues are raised and where the
        // navigation now keeps them.
        const under = [
          { label: "Sources", onClick: () => navigate({ kind: "sources" }) },
          {
            label: "GitHub",
            onClick: () => navigate({ kind: "source", id: "github" }),
          },
        ];
        if (!view.label) return [...under, { label: "Issues" }];
        return [
          ...under,
          { label: "Issues", onClick: () => navigate({ kind: "issues" }) },
          { label: activeTrackedIssueLabel?.title ?? "Issues" },
        ];
      }
      case "feed":
        return [{ label: "Activity" }];
      case "gists":
        return [{ label: "Notes" }];
      case "newGist":
        return [
          { label: "Notes", onClick: () => navigate({ kind: "gists" }) },
          { label: "New note" },
        ];
      case "gist":
        return [
          { label: "Notes", onClick: () => navigate({ kind: "gists" }) },
          { label: "Note" },
        ];
      case "settings":
        return [{ label: "Settings" }];
      case "templates":
        return [{ label: "Templates" }];
      case "insights":
        return [{ label: "Insights" }];
      case "folder": {
        const folders = data?.folders ?? [];
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        const chain: typeof folders = [];
        let cursor = byId.get(view.id);
        const visited = new Set<string>();
        while (cursor && !visited.has(cursor.id)) {
          visited.add(cursor.id);
          chain.unshift(cursor);
          cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
        }
        return chain.map((folder, index) => index < chain.length - 1
          ? { label: folder.name, onClick: () => navigate({ kind: "folder", id: folder.id }) }
          : { label: folder.name });
      }
      case "page": {
        const pages = data?.pages ?? {};
        const md = pages[view.path] ?? "";
        const segments = view.path.split("/");
        const crumbs: Crumb[] = [];
        const directory = segments.slice(0, -1).join("/");
        const persisted = data?.folders ?? [];
        const byId = new Map(persisted.map((folder) => [folder.id, folder]));
        const directFolder = persisted.find((folder) => folder.source_path === directory);
        const folderChain: typeof persisted = [];
        let cursor = directFolder;
        const visited = new Set<string>();
        while (cursor && !visited.has(cursor.id)) {
          visited.add(cursor.id);
          folderChain.unshift(cursor);
          cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
        }
        const fallbackFolders = segments.slice(0, -1).map((segment, index) => ({
          id: `path-${index}`,
          parent_id: null,
          name: segment,
          source_path: segments.slice(0, index + 1).join("/"),
          order: index,
        }));
        for (const folder of folderChain.length > 0 ? folderChain : fallbackFolders) {
          const prefix = folder.source_path;
          // Clickable to the folder's landing page if one exists (nest-parent
          // `<folder>.md`, or a conventional index/overview under it).
          const indexPath = prefix
            ? [`${prefix}.md`, `${prefix}/index.md`, `${prefix}/overview.md`].find(
                (path) => pages[path] !== undefined,
              )
            : undefined;
          crumbs.push(
            indexPath
              ? { label: folder.name, onClick: () => navigate({ kind: "page", path: indexPath }) }
              : { label: folder.name },
          );
        }
        crumbs.push({ label: pageTitleOf(view.path, md) });
        return crumbs;
      }
      case "pageHistory": {
        const md = data?.pages[view.path] ?? "";
        const path = view.path;
        return [
          {
            label: pageTitleOf(path, md),
            onClick: () => navigate({ kind: "page", path }),
          },
          { label: "History" },
        ];
      }
      case "ingest":
        return [{ label: isSynthesized ? "Ingest & synthesize" : "Ingest" }];
      case "ingestRun":
        return [
          {
            label: isSynthesized ? "Ingest & synthesize" : "Ingest",
            onClick: () => navigate({ kind: "ingest" }),
          },
          { label: "Run" },
        ];
      case "draftReview":
        return [
          {
            label: isSynthesized ? "Ingest & synthesize" : "Ingest",
            onClick: () => navigate({ kind: "ingest" }),
          },
          {
            label: "Run",
            onClick: () => navigate({ kind: "ingestRun", runId: view.runId }),
          },
          { label: "Review" },
        ];
      default: {
        // Exhaustiveness check: a MainView variant with no case here is a
        // compile error, not a silent `undefined` return.
        const exhaustive: never = view;
        return exhaustive;
      }
    }
  }, [view, data, navigate, isSynthesized, activeTrackedIssueLabel]);

  // Initiative tag (normalized) → its BHAG wiki entity, when one exists.
  const bhagByInitiative = useMemo(
    () => new Map(parentBhags.map((b) => [b.slug, b])),
    [parentBhags],
  );
  // Area slug → its Area wiki entity, when one exists.
  const areaByLabel = useMemo(
    () => new Map(parentAreas.map((a) => [a.slug, a])),
    [parentAreas],
  );

  // BHAG → Area → Project up-links, shown as breadcrumb segments instead of
  // badge chips now that the hierarchy is explicit. Only the first tag at
  // each level is shown — a breadcrumb is inherently a single path, unlike
  // the badge cluster which could list every tag.
  // Resolved as data first, because Home's "Part of" card reads the same
  // trail: two walks up one hierarchy are two chances to disagree about it.
  const ancestors = useMemo<AncestorRow[]>(() => {
    const out: AncestorRow[] = [];
    const named = (entity: { slug: string; name?: string; title?: string }) =>
      entity.title ?? entity.name ?? entity.slug;
    if (isArea) {
      const b = initiatives.length > 0 ? bhagByInitiative.get(initiatives[0]) : undefined;
      if (b) out.push({ slug: b.slug, title: named(b), type: "bhag" });
    } else if (!isBhag) {
      const directBhag =
        initiatives.length > 0 ? bhagByInitiative.get(initiatives[0]) : undefined;
      const bhag = directBhag ?? transitiveBhags[0];
      if (bhag) out.push({ slug: bhag.slug, title: named(bhag), type: "bhag" });
      const area = areaTags.length > 0 ? areaByLabel.get(areaTags[0]) : undefined;
      if (area) out.push({ slug: area.slug, title: named(area), type: "area" });
    }
    return out;
  }, [isArea, isBhag, initiatives, bhagByInitiative, transitiveBhags, areaTags, areaByLabel]);

  const hierarchyCrumbs = useMemo<Crumb[]>(
    () =>
      ancestors.map((node) =>
        node.type === "bhag"
          ? {
              label: node.title,
              href: `/projects/${node.slug}/tome`,
              icon: <Target className="h-3.5 w-3.5 shrink-0 text-primary" />,
              colorClass: "text-primary",
            }
          : {
              label: node.title,
              href: `/projects/${node.slug}/tome`,
              icon: <Layers className="h-3.5 w-3.5 shrink-0 text-sky-500" />,
              colorClass: "text-sky-600 dark:text-sky-400",
            },
      ),
    [ancestors],
  );

  /**
   * Whether this reader has switched to the new rail.
   *
   * Read through the store rather than the non-React helper so that turning
   * it on in Settings reaches an open project without a reload.
   */
  const navV2 = useFeatureFlagStore((state) => state.isEnabled("tomeNavV2"));
  const initializeFlags = useFeatureFlagStore((state) => state.initialize);
  useEffect(() => initializeFlags(), [initializeFlags]);

  /**
   * The tree, read as two: the pages the team writes, and the material it
   * mirrors. Only the new rail shows them apart; the old one shows the lot.
   */
  // The whole tree, not the filtered one. The only search box left is in
  // Settings > Content, and a query typed there must not quietly shorten the
  // navigation and the landing views, where there would be nothing to explain
  // the missing pages and nothing to clear.
  const wikiSplit = useMemo(
    () => splitWikiTree(data?.tree ?? []),
    [data?.tree],
  );
  // The terms themselves, not the folder holding them: the rail's figures
  // say how much is behind a row, and "1" for a glossary of forty words
  // would be a lie told in the same column as every honest count.
  // The mirrored material, sorted into the systems it arrived from.
  const sources = useMemo(
    () => groupBySource(wikiSplit.reference),
    [wikiSplit.reference],
  );
  const glossaryTerms = useMemo(
    () =>
      wikiSplit.glossary.reduce(
        (total, node) => total + (node.kind === "folder" ? node.children.length : 1),
        0,
      ),
    [wikiSplit.glossary],
  );
  // Open by default: the pages are the point of the place. Reference material
  // is not, so it starts folded away and stays however the reader left it.
  const [wikiOpen, setWikiOpen] = usePersistentDisclosure(
    `tome.v2.wiki.expanded.${slug}`,
    true,
  );
  const [referencesOpen, setReferencesOpen] = usePersistentDisclosure(
    `tome.v2.references.expanded.${slug}`,
    false,
  );
  const [sourcesOpen, setSourcesOpen] = usePersistentDisclosure(
    `tome.v2.sources.expanded.${slug}`,
    false,
  );
  // One system open at a time, and none to begin with: five systems opened
  // together would bury everything below them under the whole of what this
  // space has ever read.
  const [openSource, setOpenSource] = useState<string | null>(null);
  // Only for the rail that reports counts, and only for the rows whose
  // contents are not already in the wiki payload.
  const railCounts = useTomeRailCounts(slug, {
    issues: navV2 && showIssuesReport,
  });

  // Spaces tagged into the same category as this one. They sit in
  // Connections beside the sources, both being things this space is attached
  // to rather than things inside it.
  const { related } = useRelatedSpaces(slug);

  const navActive = {
    summary: view.kind === "summary",
    agent: view.kind === "agent",
    standup: view.kind === "standup",
    meetings: view.kind === "meetings",
    issues: view.kind === "issues" && !view.label,
    feed: view.kind === "feed",
    gists: view.kind === "gists" || view.kind === "newGist" || view.kind === "gist",
    wiki: view.kind === "wiki",
    glossary: view.kind === "glossary",
    related: view.kind === "related",
    sources: view.kind === "sources",
    settings: view.kind === "settings",
    templates: view.kind === "templates",
    insights: view.kind === "insights",
    ingest:
      view.kind === "ingest" || view.kind === "ingestRun" || view.kind === "draftReview",
    page:
      view.kind === "page" || view.kind === "pageHistory" ? view.path : null,
    folder: view.kind === "folder" ? view.id : null,
  };

  const feedbackPagePath =
    view.kind === "page" || view.kind === "pageHistory" ? view.path : undefined;

  /**
   * Adding a label to track, which both rails offer in the same place: beside
   * the Issues row, where the list it extends already is. Held as one node so
   * the dialog and its state exist once however the rail is drawn.
   */
  const addTrackedLabelAction = (
    canEdit ? (
      <Dialog
        open={trackerDialogOpen}
        onOpenChange={(open) => {
          if (!creatingTracker) setTrackerDialogOpen(open);
          if (!open) {
            setTrackerSuffix("");
            setTrackerError(null);
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <button
                type="button"
                aria-label="Add tracked label"
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Add tracked label</TooltipContent>
        </Tooltip>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add tracked label</DialogTitle>
            <DialogDescription>
              This project will track GitHub issues carrying this label.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor={`tome-tracker-suffix-${slug}`} className="text-sm font-medium">
              GitHub label
            </label>
            <Input
              id={`tome-tracker-suffix-${slug}`}
              value={trackerSuffix}
              onChange={(event) => {
                setTrackerSuffix(event.target.value);
                setTrackerError(null);
              }}
              placeholder="security-review"
              aria-invalid={duplicateIssueTracker ? true : undefined}
              aria-describedby={duplicateIssueTracker
                ? `tome-tracker-duplicate-${slug}`
                : undefined}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Use lowercase letters, numbers, and hyphens.
            </p>
            {duplicateIssueTracker && (
              <p
                id={`tome-tracker-duplicate-${slug}`}
                role="alert"
                className="text-xs text-destructive"
              >
                This project already tracks the GitHub label{" "}
                <code>{duplicateIssueTracker.label}</code>.
              </p>
            )}
          </div>
          {trackerError && (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {trackerError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTrackerDialogOpen(false)}
              disabled={creatingTracker}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void createIssueTracker()}
              disabled={
                creatingTracker
                || !trackerSuffix.trim()
                || Boolean(duplicateIssueTracker)
              }
            >
              {creatingTracker && <Loader2 className="h-4 w-4 animate-spin" />}
              Create tracker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null
  );

  /**
   * The page tree, with the states that stand in for it.
   *
   * Taken as an argument rather than read from scope because the new rail
   * draws two of them — the pages the team writes, and the material it
   * mirrors — and both need the same answer to "still loading", "nothing
   * here yet" and "nothing matches that search".
   *
   * `editable` is what separates the two navigations. WikiSidebar draws each
   * action only where it was given a handler for it, so navigation-only is
   * the same tree asked for without them, not a second component.
   */
  const renderWikiTree = (
    tree: PageTreeNode[],
    {
      editable,
      emptyNote,
      selectable,
      showMeta,
    }: {
      editable: boolean;
      emptyNote?: string;
      selectable?: boolean;
      showMeta?: boolean;
    },
  ) => {
    if (loading) return <SidebarSkeleton />;
    if (tree.length === 0) {
      // A search that found nothing is the reader's own doing, and says so
      // before anything else: the tree is not empty, their query is.
      if (wikiQuery.trim())
        return (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No pages or folders match “{wikiQuery.trim()}”.
          </p>
        );
      // Only the tree that owns the wiki offers to fill it. Without this a
      // space with nothing in it would offer an ingest twice, once under each
      // heading, as though they were two different things to do.
      if (emptyNote)
        return (
          <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
            {emptyNote}
          </p>
        );
      return (
        <div className="px-2 py-2 text-xs text-muted-foreground">
          <p className="mb-2">No wiki pages yet.</p>
          <ViewOnlyTooltip viewOnly={!canEdit}>
            <Button
              size="sm"
              onClick={() => navigate({ kind: "ingest" })}
              disabled={!canEdit}
            >
              {isSynthesized ? "Ingest & synthesize" : "Run an ingest"}
            </Button>
          </ViewOnlyTooltip>
        </div>
      );
    }
    if (!data) return null;
    return (
      <WikiSidebar
        tree={tree}
        selectedPath={navActive.page}
        selectedFolderId={navActive.folder}
        onSelect={openPage}
        onSelectFolder={openFolder}
        showHidden={showHidden}
        onDelete={editable && canEdit ? deletePage : undefined}
        onCreateFolder={editable && canEdit ? openCreateFolder : undefined}
        onCreatePage={editable && canEdit ? openNewPage : undefined}
        onEditFolder={editable && canEdit ? openEditFolder : undefined}
        onDeleteFolder={editable && canEdit ? deleteWikiFolder : undefined}
        onMoveItem={editable && canEdit ? moveWikiItem : undefined}
        unreadPaths={unreadPaths}
        checkedPaths={selectable && canEdit ? checkedPaths : undefined}
        onCheckedChange={selectable && canEdit ? toggleChecked : undefined}
        showMeta={showMeta ?? true}
      />
    );
  };

  /**
   * What is true of the wiki as a whole: which pages are shown, and getting
   * all of them out.
   *
   * Separated from the controls that create and remove pages because the new
   * navigation puts the two in different places — these under Content,
   * General, where a setting lives, and the rest beside the tree they act on.
   * The old rail keeps them together above the tree, as it always did.
   */
  const wikiViewToolbar = (
    <div className="flex items-center gap-0.5 text-muted-foreground">
      {!isEmpty && !loading && (
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          title={showHidden ? "Hide agent-only pages" : "Show agent-only pages"}
          className="rounded p-1 hover:bg-muted hover:text-foreground"
        >
          {showHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
      {!isEmpty && !loading && <WikiExportMenu slug={slug} />}
    </div>
  );

  /**
   * Making pages: a folder, an import, a blank page.
   *
   * Held as one node rather than written where it is shown, because the two
   * navigations put it in different places and a second copy of three
   * buttons and a dialog is a second copy of their behaviour.
   */
  const wikiPageToolbar = (
    <div className="flex items-center gap-0.5 text-muted-foreground">
      {!loading && canEdit && (
        <button
          type="button"
          onClick={() => openCreateFolder(null)}
          title="New folder"
          aria-label="New folder"
          className="rounded p-1 hover:bg-muted hover:text-foreground"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      )}
      {!loading && canEdit && (
        <button
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          title="Import Markdown, text, HTML, DOCX, or PDF files"
          aria-label="Import pages"
          disabled={importing}
          className="rounded p-1 hover:bg-muted hover:text-foreground"
        >
          {importing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      {!loading && canEdit && (
        <Dialog
          open={newPageOpen}
          onOpenChange={(o) => {
            setNewPageOpen(o);
            if (o) {
              setTimeout(() => newPageInputRef.current?.focus(), 0);
            } else {
              setNewPageName("");
              setNewPageParentFolder(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <button
              type="button"
              title="New page"
              aria-label="New page"
              onClick={() => openNewPage()}
              className="rounded p-1 hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {newPageParentFolder
                  ? `New page in ${newPageParentFolder.title}`
                  : "New wiki page"}
              </DialogTitle>
              <DialogDescription>
                Enter a page name, then draft it in the editor or ask the agent to help.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = newPageName.trim();
                if (!name) return;
                void createPage(name, {
                  parentFolderId: newPageParentFolder?.id,
                  openEditor: true,
                });
                setNewPageOpen(false);
                setNewPageName("");
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <label
                  htmlFor="tome-new-page-input"
                  className="block text-sm font-medium text-foreground"
                >
                  Page name
                </label>
                <Input
                  id="tome-new-page-input"
                  ref={newPageInputRef}
                  value={newPageName}
                  onChange={(e) => setNewPageName(e.target.value)}
                  placeholder="new-page.md"
                  className="font-mono text-sm"
                  aria-label="New page name"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setNewPageOpen(false);
                    setNewPageName("");
                    uploadInputRef.current?.click();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Upload className="h-4 w-4" />
                  Import instead
                </button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!newPageName.trim()}
                    onClick={() => promptAgentForPage(newPageName)}
                  >
                    <Sparkles className="h-4 w-4" />
                    Ask agent
                  </Button>
                  <Button type="submit" size="sm" disabled={!newPageName.trim()}>
                    Write in editor
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <div
        ref={wikiRootRef}
        data-fullscreen-mode={isFallbackFullscreen ? "fallback" : isFullscreen ? "native" : "off"}
        className={cn(
          "flex h-full min-h-[calc(100vh-4rem)] flex-col bg-background",
          isFallbackFullscreen && "fixed inset-0 z-[100] h-dvh min-h-0",
        )}
      >
        <header className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b px-6 py-2 text-sm">
          {/* Keep the global route hierarchy in one breadcrumb trail. The
              project detail/apps page is still reachable via `?apps=1` when
              needed, but it should not become a second breadcrumb row. */}
          <HeaderBreadcrumbPortal>
            <Breadcrumb
              onBeforeNavigate={interceptHrefNavigation}
              items={[
                { label: "Home", href: "/" },
                { label: getProjectsNavigationLabel(), href: "/projects" },
                ...hierarchyCrumbs,
                {
                  label: projectTitle ?? slug,
                  onClick: () => navigate({ kind: "summary" }),
                  icon: isBhag ? (
                    <Target className="h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : isArea ? (
                    <Layers className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                  ) : undefined,
                  colorClass: isBhag ? "text-primary" : isArea ? "text-sky-600 dark:text-sky-400" : undefined,
                },
                ...crumbs,
              ]}
            />
          </HeaderBreadcrumbPortal>
          <div className="min-w-0 flex-1">
            {projectMetaLoading ? (
              <div className="flex flex-col gap-2" data-testid="skeleton">
                <div className="h-5 w-48 animate-pulse rounded bg-muted" />
                <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
                <div className="flex gap-1.5">
                  <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                  <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
                  <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
                </div>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-1.5">
                  <h1 className="truncate text-lg font-semibold leading-tight">
                    {projectTitle ?? slug}
                  </h1>
                  <ProjectMetadataInfo
                    teamName={projectMeta.teamName}
                    dataSteward={projectMeta.dataSteward}
                    tags={projectMeta.tags}
                  />
                </div>
                {projectMeta.description && (
                  <ProjectDescription description={projectMeta.description} />
                )}
              </>
            )}
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
            <TomeProductFeedback projectSlug={slug} pagePath={feedbackPagePath} />
            {view.kind === "agent" && (
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
            )}
            {/* Watching the whole space moved to Settings, Notifications on
                the new navigation, beside the rest of what is configured
                here; a page keeps its own toggle, which is the one most
                people reach for. Full screen went with it: a reader who
                wants the chrome gone has the browser's own. */}
            {!navV2 && <FollowMenu slug={slug} />}
            <McpConnectDialog />
            {!navV2 && (
              <Button
                variant="outline"
                size="sm"
                className="h-auto gap-1.5 px-2 py-1"
                onClick={() => void toggleFullscreen()}
                aria-pressed={isFullscreen}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
                Toggle full screen
              </Button>
            )}
          </div>
        </header>

        {error && (
          <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {projectSidebarOpen && (
            <button
              type="button"
              aria-label="Close project sidebar"
              className="absolute inset-0 z-10 bg-background/60 backdrop-blur-sm md:hidden"
              onClick={closeProjectSidebar}
            />
          )}
          {!projectSidebarOpen && (
            <div className="flex w-10 shrink-0 items-start justify-center border-r bg-background/60 pt-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={toggleProjectSidebar}
                    aria-label="Show project sidebar"
                    aria-controls={`tome-project-sidebar-${slug}`}
                    aria-expanded={false}
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Show project sidebar</TooltipContent>
              </Tooltip>
            </div>
          )}
          {/* Side nav: Chat + Ingest destinations, then the wiki page tree. */}
          <aside
            id={`tome-project-sidebar-${slug}`}
            aria-hidden={!projectSidebarOpen}
            inert={projectSidebarOpen ? undefined : true}
            className={cn(
              "absolute inset-y-0 left-0 z-20 flex w-[calc(100%-3rem)] max-w-xs flex-col overflow-hidden border-r bg-background shadow-xl transition-[transform,width] duration-200 md:relative md:inset-auto md:z-auto md:shrink-0 md:shadow-none",
              projectSidebarOpen
                ? "translate-x-0 md:w-80"
                : "pointer-events-none -translate-x-full md:w-0 md:translate-x-0 md:border-r-0",
            )}
          >
            <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Navigation
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={toggleProjectSidebar}
                    aria-label="Collapse project sidebar"
                    aria-controls={`tome-project-sidebar-${slug}`}
                    aria-expanded
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Collapse project sidebar</TooltipContent>
              </Tooltip>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col p-3">
                {navV2 && (
                  <div className="flex flex-col gap-1">
                    <NavItem
                      icon={<Gauge className="h-4 w-4" />}
                      label="Overview"
                      active={navActive.summary}
                      onClick={() => navigate({ kind: "summary" })}
                      tipTitle="Overview"
                      tipDescription="What this space is and how it is going: who works on it, what needs attention, what was agreed, and where its knowledge comes from."
                      reserveCaret
                    />

                    <NavSection
                      icon={<BookOpen className="h-4 w-4" />}
                      label="Wiki"
                      active={
                        navActive.wiki ||
                        navActive.glossary ||
                        Boolean(navActive.page ?? navActive.folder)
                      }
                      expanded={wikiOpen}
                      onToggle={() => setWikiOpen(!wikiOpen)}
                      onClick={() => navigate({ kind: "wiki" })}
                      count={
                        loading
                          ? undefined
                          : wikiSplit.authored.length + 1
                      }
                      controlsId={`tome-v2-wiki-${slug}`}
                    >
                      {renderWikiTree(wikiSplit.authored, {
                            editable: false,
                            showMeta: false,
                          })}

                      {/* Below the pages rather than among them: the pages
                          are what this space wrote, and the glossary is the
                          vocabulary they are written in. A fixed row, so it
                          is there to be opened before any term exists. */}
                      <button
                        type="button"
                        onClick={() => navigate({ kind: "glossary" })}
                        className={cn(
                          // Measured against the rows above rather than
                          // copied from one of them: this row sits directly
                          // under the section while the tree's rows sit
                          // inside it, so matching their padding would not
                          // have matched their figures. Eight pixels puts
                          // this one in the same column as the rest.
                          "mt-1 flex w-full items-center gap-1.5 rounded py-1 pl-1.5 pr-2 text-left text-sm transition-colors hover:bg-muted",
                          navActive.glossary && "bg-muted font-medium text-primary",
                        )}
                      >
                        <BookA className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">Glossary</span>
                        {/* The caret's width, kept empty: this row has
                            nothing to open, and without it its figure would
                            stand alone outside the column every other row's
                            figure sits in. */}
                        <span className="flex shrink-0 items-center">
                          <NavCount count={loading ? undefined : glossaryTerms} />
                          <span aria-hidden className="h-3.5 w-3.5 shrink-0" />
                        </span>
                      </button>
                    </NavSection>

                    <NavItem
                      icon={<CalendarDays className="h-4 w-4" />}
                      label="Meetings"
                      active={navActive.meetings}
                      onClick={() => navigate({ kind: "meetings" })}
                      count={railCounts.meetings}
                      tipTitle="Meetings"
                      tipDescription="The recurring calls this space listens to, and what came of each one. Transcripts become pages once a meeting ends."
                      reserveCaret
                    />

                    {/* Grouped by the system the material came from rather
                        than listed as the folders it arrived in. Issues sit
                        under GitHub, with the repositories they are raised
                        against, instead of beside Notes as though they were
                        something this space wrote. */}
                    <NavSection
                      icon={<Plug className="h-4 w-4" />}
                      label="Sources"
                      active={
                        navActive.sources ||
                        view.kind === "source" ||
                        navActive.issues ||
                        view.kind === "issues" ||
                        Boolean(navActive.page && isReferencePath(navActive.page))
                      }
                      expanded={sourcesOpen}
                      onToggle={() => setSourcesOpen(!sourcesOpen)}
                      onClick={() => navigate({ kind: "sources" })}
                      count={loading ? undefined : sources.length}
                      controlsId={`tome-v2-sources-${slug}`}
                    >
                      {sources.map(({ source, nodes, count }) => {
                        const isGithub = source.id === "github";
                        const showIssues = isGithub && showIssuesReport;
                        return (
                          <NavSection
                            key={source.id}
                            icon={
                              <ProviderLogo
                                provider={source.provider}
                                className="h-4 w-4 shrink-0 object-contain"
                              />
                            }
                            label={source.name}
                            active={
                              (view.kind === "source" && view.id === source.id) ||
                              (isGithub && view.kind === "issues")
                            }
                            expanded={openSource === source.id}
                            onToggle={() =>
                              setOpenSource(
                                openSource === source.id ? null : source.id,
                              )
                            }
                            onClick={() =>
                              navigate({ kind: "source", id: source.id })
                            }
                            // The issues are one of the things behind GitHub,
                            // so they are counted as one of them.
                            count={
                              loading ? undefined : count + (showIssues ? 1 : 0)
                            }
                            controlsId={`tome-v2-source-${source.id}-${slug}`}
                          >
                            {showIssues && (
                              <NavItem
                                icon={<ListChecks className="h-4 w-4" />}
                                label="Issues"
                                active={navActive.issues}
                                onClick={() => navigate({ kind: "issues" })}
                                count={railCounts.issues}
                                tipTitle="GitHub issues"
                                tipDescription="Issues linked from attached GitHub repositories. GitHub remains authoritative while TOME serves a webhook-backed read cache."
                                reserveCaret
                              />
                            )}
                            {renderWikiTree(nodes, {
                              editable: false,
                              emptyNote: source.unavailable
                                ? `${source.name} is not connected to this space yet.`
                                : `Nothing read from ${source.name} yet.`,
                            })}
                          </NavSection>
                        );
                      })}
                    </NavSection>

                    <NavItem
                      icon={<NotebookPen className="h-4 w-4" />}
                      label="Notes"
                      active={navActive.gists}
                      onClick={() => navigate({ kind: "gists" })}
                      count={railCounts.notes}
                      tipTitle="Notes"
                      tipDescription="Quick, non-committal chunks of context — a prompt, an agent memory, a snippet — saved without becoming part of the curated wiki."
                      reserveCaret
                    />

                    {/* What the mirrored sources left behind: the spaces
                        tagged into the same categories as this one. Those
                        are projects, which the old name claimed and never
                        held. */}
                    <NavSection
                      icon={<FileSymlink className="h-4 w-4" />}
                      label="Related projects"
                      active={navActive.related}
                      expanded={referencesOpen}
                      onToggle={() => setReferencesOpen(!referencesOpen)}
                      onClick={() => navigate({ kind: "related" })}
                      count={related.length}
                      controlsId={`tome-v2-related-${slug}`}
                    >
                      <RelatedSpacesRail related={related} bare />
                    </NavSection>
                  </div>
                )}

                {/* Settings sits apart, below the gap: it is where the space
                    is configured rather than one of the places it holds. */}
                {navV2 && (
                  <div className="mt-6 flex flex-col gap-1">
                    <NavItem
                      icon={<Settings className="h-4 w-4" />}
                      label="Settings"
                      active={navActive.settings}
                      onClick={() => navigate({ kind: "settings" })}
                      tipTitle="Settings"
                      tipDescription="Everything this space is configured by, including every action on its pages: what it reads, what it writes, who is told, and how it looks."
                      reserveCaret
                    />
                  </div>
                )}

                <div className={cn("flex flex-col gap-1", navV2 && "hidden")}>
                  <NavItem
                    icon={<House className="h-4 w-4" />}
                    label="Home"
                    active={navActive.summary}
                    onClick={() => navigate({ kind: "summary" })}
                    tipTitle="Home"
                    tipDescription="What this space is and how it is going: who works on it, what needs attention, what was agreed, and where its knowledge comes from."
                  />
                  <NavItem
                    icon={<MessageSquare className="h-4 w-4" />}
                    label="Agent"
                    active={navActive.agent}
                    onClick={() => navigate({ kind: "agent" })}
                    tipTitle="Agent"
                    tipDescription="Chat with the project's agent: ask it questions about the project, or have it draft, refine, and reorganize the wiki pages it reads and writes."
                  />
                  <NavItem
                    icon={
                      <RefreshCw
                        className={cn("h-4 w-4", locked && !awaitingReview && "animate-spin")}
                      />
                    }
                    label={isSynthesized ? "Ingest & synthesize" : "Ingest"}
                    active={navActive.ingest}
                    onClick={() => navigate({ kind: "ingest" })}
                    tipTitle={isSynthesized ? "Ingest & synthesize" : "Ingest"}
                    tipDescription={
                      isSynthesized
                        ? `Ingest this ${isArea ? "area's" : "BHAG's"} directly attached sources, then synthesize them with its tagged project wikis.`
                        : "Start an ingest run that (re)builds the wiki from the project's attached sources: GitHub repos, Confluence spaces, Webex rooms, and opted-in MyAgent evidence."
                    }
                    tag={awaitingReview ? "needs review" : undefined}
                  />
                  <NavItem
                    icon={<MessagesSquare className="h-4 w-4" />}
                    label="Activity"
                    active={navActive.feed}
                    onClick={() => navigate({ kind: "feed" })}
                    tipTitle="Activity"
                    tipDescription="The project's activity feed: GitHub and ingest events, shared notes, plus live discussion, powered by Mycelium. People and agents post here; the wiki holds the context, this holds the activity and signal around it."
                  />
                  <NavItem
                    icon={<FileText className="h-4 w-4" />}
                    label="Notes"
                    active={navActive.gists}
                    onClick={() => navigate({ kind: "gists" })}
                    tipTitle="Notes"
                    tipDescription="Quick, non-committal chunks of context (a prompt, an agent memory, a snippet) saved without becoming part of the curated wiki. Share one into the activity feed when a teammate should see it."
                  />
                  <NavItem
                    icon={<Activity className="h-4 w-4" />}
                    label="Insights"
                    active={navActive.insights}
                    onClick={() => navigate({ kind: "insights" })}
                    tipTitle="Insights"
                    tipDescription="How this project's wiki and chat are being used: who's chatting, how much, and this project's own ingestion and wiki-size numbers."
                  />
                  <NavItem
                    icon={<LayoutTemplate className="h-4 w-4" />}
                    label="Templates"
                    active={navActive.templates}
                    onClick={() => navigate({ kind: "templates" })}
                    tipTitle="Templates"
                    tipDescription="Check whether this wiki's pages still match the current page-template config: which pages are missing, unbound, behind, or drifted. Read-only; resolving flagged pages happens through a normal ingest."
                  />
                  <NavItem
                    icon={<Settings className="h-4 w-4" />}
                    label="Settings"
                    active={navActive.settings}
                    onClick={() => navigate({ kind: "settings" })}
                    tipTitle="Settings"
                    tipDescription="Reconfigure this project: its title, description, and sources (GitHub repos, Confluence spaces, Webex rooms). Changes apply to future ingests."
                  />
                </div>

                {!navV2 && showReports && (
                  <ReportsDisclosure slug={slug}>
                    {showStandupReport && (
                      <NavItem
                        icon={<Newspaper className="h-4 w-4" />}
                        label="Standup"
                        active={navActive.standup}
                        onClick={() => navigate({ kind: "standup" })}
                        tipTitle="Standup"
                        tipDescription="The project's report card: headline, blockers, and what's next. Rewritten by the agent on every ingest. (This feature is still in testing.)"
                      />
                    )}
                    {showIssuesReport && (
                  <IssueLabelDisclosure
                    slug={slug}
                    controlsId={`tome-issue-label-views-${slug}`}
                    header={
                      <NavItem
                        icon={<ListChecks className="h-4 w-4" />}
                        label="Issues"
                        active={navActive.issues}
                        onClick={() => navigate({ kind: "issues" })}
                        tipTitle="GitHub issues"
                        tipDescription="Issues linked from attached GitHub repositories. GitHub remains authoritative while TOME serves a webhook-backed read cache; Areas and BHAGs roll up readable child projects."
                      />
                    }
                    actions={addTrackedLabelAction}
                  >
                    <IssueLabelViewList
                      labels={issueTrackers}
                      activeLabel={activeTrackedIssueLabel?.label}
                      onSelect={(label) => navigate({ kind: "issues", label })}
                      onRemove={canRemoveIssueTrackers ? removeIssueTracker : undefined}
                    />
                    {trackerRemovalError && (
                      <p className="ml-5 mt-1 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                        {trackerRemovalError}
                      </p>
                    )}
                  </IssueLabelDisclosure>
                    )}
                  </ReportsDisclosure>
                )}

                <div
                  className={cn(
                    "mt-6 flex items-center justify-between gap-1 px-2 pb-1.5",
                    navV2 && "hidden",
                  )}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Wiki
                  </span>
                    {!navV2 && (
                  <div className="flex items-center gap-0.5">
                    {wikiViewToolbar}
                    {wikiPageToolbar}
                  </div>
                )}
                </div>

                <input
                  ref={uploadInputRef}
                  type="file"
                  accept={TOME_IMPORT_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) void uploadPages(files);
                    e.target.value = "";
                  }}
                />

                {!navV2 && renderWikiTree(filteredWikiTree, { editable: true })}

                {/* Synthesized-type down-links: the projects tagged to this
                    BHAG/Area. Links out to each project's own wiki — the
                    roll-up reads these same children; this makes the
                    hierarchy navigable (#92). */}
                {isSynthesized && (
                  <div className="mt-6">
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isBhag ? "Areas & Projects" : "Projects"}
                    </div>
                    {isBhag ? (
                      childAreas.length === 0 && childProjects.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-muted-foreground/70">
                          No areas or projects tagged to this BHAG yet.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {childAreas.length > 0 && (
                            <div className="flex flex-col gap-1 pl-3">
                              {childAreas.map((area) => (
                                <Link
                                  key={area.slug}
                                  href={`/projects/${area.slug}/tome`}
                                  className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-sky-600 transition hover:bg-accent dark:text-sky-400"
                                >
                                  <Layers className="h-4 w-4 shrink-0" />
                                  <span className="truncate">{area.title}</span>
                                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                                    {area.projectCount}
                                  </span>
                                  <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
                                </Link>
                              ))}
                            </div>
                          )}
                          {childAreas.length > 0 && childProjects.length > 0 && (
                            <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                              Tagged directly (no area)
                            </p>
                          )}
                          {childProjects.length > 0 && (
                            <div className="flex flex-col gap-1">
                              {childProjects.map((child) => (
                                <Link
                                  key={child.slug}
                                  href={`/projects/${child.slug}/tome`}
                                  className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground/80 transition hover:bg-accent hover:text-foreground"
                                >
                                  <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <span className="truncate">{child.title}</span>
                                  <ArrowUpRight className="ml-auto h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    ) : childProjects.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted-foreground/70">
                        No projects tagged to this area yet.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {childProjects.map((child) => (
                          <Link
                            key={child.slug}
                            href={`/projects/${child.slug}/tome`}
                            className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground/80 transition hover:bg-accent hover:text-foreground"
                          >
                            <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{child.title}</span>
                            <ArrowUpRight className="ml-auto h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Incoming edges: relationships authored in OTHER
                    projects that point at this one. Outgoing edges are
                    ordinary pages under this project's own `edges/` dir and
                    already show in the tree above. */}
                {incomingEdges.length > 0 && (
                  <div className="mt-6">
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Referenced by
                    </div>
                    <div className="flex flex-col gap-1">
                      {incomingEdges.map((e) => (
                        <Link
                          key={`${e.source_project_slug}:${e.path}`}
                          href={`/projects/${e.source_project_slug}/tome/wiki/${e.path}`}
                          title={`${e.source} ${e.relation} ${e.target}`}
                          className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground/80 transition hover:bg-accent hover:text-foreground"
                        >
                          <Link2 className="h-4 w-4 shrink-0 text-amber-500" />
                          <span className="truncate">
                            {e.source_project_slug}: {e.relation}
                          </span>
                          <ArrowUpRight className="ml-auto h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>

          {/* Main pane: replaced wholesale by the active view. */}
          <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {view.kind === "summary" ? (
              <ScrollArea className="min-h-0 min-w-0 flex-1">
                <ProjectHomeView
                  slug={slug}
                  title={projectTitle ?? slug}
                  // Left undefined until the entity's own record is in, so
                  // the cards whose wording depends on the kind wait rather
                  // than telling the reader of a BHAG to connect a
                  // repository and then changing their mind.
                  kind={projectMetaLoading ? undefined : projectType}
                  // The wiki beside this has already loaded every page, so
                  // the cards reading the curated ones cost nothing.
                  pages={data?.pages}
                  sources={projectMeta.sources}
                  // The same trail the breadcrumb above walks, left undefined
                  // until the tags it is read from are in.
                  ancestors={projectMetaLoading ? undefined : ancestors}
                  onAsk={(question) => {
                    setAgentPrefill(question);
                    navigate({ kind: "agent" });
                  }}
                  onOpenPage={openArtifact}
                  onOpenStandup={
                    showStandupReport ? () => navigate({ kind: "standup" }) : undefined
                  }
                  onOpenSettings={() => navigate({ kind: "settings" })}
                  onOpenIngest={() => navigate({ kind: "ingest" })}
                  onNavigate={(path) => navigate({ kind: "page", path })}
                />
              </ScrollArea>
            ) : view.kind === "agent" ? (
              <>
                <div className="min-h-0 min-w-0 flex-1">
                  <ChatPanel
                    slug={slug}
                    projectTitle={projectTitle ?? undefined}
                    onPagesChanged={load}
                    onOpenPage={openArtifact}
                    glossaryPreview={glossaryPreview}
                    initialPrompt={agentPrefill}
                    onInitialPromptConsumed={() => setAgentPrefill(null)}
                  />
                </div>
                {artifactPath && (
                  <div className="w-[45%] min-w-[360px] shrink-0 border-l">
                    {data && data.pages[artifactPath] !== undefined ? (
                      <WikiPageView
                        slug={slug}
                        path={artifactPath}
                        markdown={data.pages[artifactPath]}
                        onWrite={writeMarkdown}
                        onReload={load}
                        onClose={() => setArtifactPath(null)}
                        locked={locked}
                        awaitingReview={awaitingReview}
                        onNavigate={openArtifact}
                        glossaryPreview={glossaryPreview}
                        onRename={canEdit ? renamePage : undefined}
                        canEdit={canEdit}
                        knownPaths={knownPagePaths}
                        teamName={projectMeta.teamName}
                      />
                    ) : (
                      <TomeLoading />
                    )}
                  </div>
                )}
              </>
            ) : view.kind === "meetings" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <MeetingsView slug={slug} />
              </div>
            ) : view.kind === "standup" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <StandupView
                  markdown={data?.pages["standup.md"]}
                  onNavigate={(path) => navigate({ kind: "page", path })}
                  glossaryPreview={glossaryPreview}
                  onStartIngest={() => navigate({ kind: "ingest" })}
                  isSynthesized={isSynthesized}
                  canEdit={canEdit}
                />
              </div>
            ) : view.kind === "issues" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <GithubIssuesPanel
                  key={activeTrackedIssueLabel?.id ?? "all"}
                  slug={slug}
                  canEdit={canEdit}
                  initialLabel={activeTrackedIssueLabel?.label}
                  title={activeTrackedIssueLabel?.title}
                  trackedLabels={issueTrackers}
                  {...(navV2
                    ? {
                        onSelectLabel: (label: string) =>
                          navigate({ kind: "issues", label }),
                        onRemoveLabel: canRemoveIssueTrackers
                          ? removeIssueTracker
                          : undefined,
                        addLabelAction: addTrackedLabelAction,
                      }
                    : {})}
                />
                {navV2 && trackerRemovalError && (
                  <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                    {trackerRemovalError}
                  </p>
                )}
              </div>
            ) : view.kind === "feed" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <FeedPanel
                  slug={slug}
                  onOpenPage={(path) => navigate({ kind: "page", path })}
                  onOpenIngestRun={(runId) => navigate({ kind: "ingestRun", runId })}
                  onOpenGist={(id) => navigate({ kind: "gist", id })}
                />
              </div>
            ) : view.kind === "gists" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <GistsPanel
                  slug={slug}
                  canEdit={canEdit}
                  onOpenGist={(id) => navigate({ kind: "gist", id })}
                  onNewGist={openNewGist}
                />
              </div>
            ) : view.kind === "newGist" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <GistView
                  key="new-gist"
                  slug={slug}
                  canEdit={canEdit}
                  onBack={() => navigate({ kind: "gists" })}
                  onCreated={(id) => navigate({ kind: "gist", id })}
                />
              </div>
            ) : view.kind === "gist" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <GistView
                  key={view.id}
                  slug={slug}
                  id={view.id}
                  canEdit={canEdit}
                  onBack={() => navigate({ kind: "gists" })}
                />
              </div>
            ) : view.kind === "settings" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <ProjectSettingsPanel
                  slug={slug}
                  onSaveBarInsetChange={setAssistantBottomInset}
                  onSaved={applyProjectMeta}
                  onOpenIngest={() => navigate({ kind: "ingest" })}
                  pagesManager={
                    navV2 ? (
                      <WikiContentManager
                        toolbar={wikiPageToolbar}
                        tree={renderWikiTree(filteredWikiTree, {
                          editable: true,
                          selectable: true,
                        })}
                        query={wikiQuery}
                        onQueryChange={setWikiQuery}
                        checked={checkedNodes}
                        busy={bulkBusy}
                        folders={data?.folders ?? []}
                        onClear={clearChecked}
                        onMove={bulkMoveChecked}
                        onDelete={bulkDeleteChecked}
                      />
                    ) : undefined
                  }
                  contentGeneral={navV2 ? wikiViewToolbar : undefined}
                />
              </div>
            ) : view.kind === "templates" ? (
              <div className="min-w-0 flex-1 overflow-auto">
                <TemplatesPanel
                  slug={slug}
                  onNavigate={(path) => navigate({ kind: "page", path })}
                  onIngestStarted={(runId) => navigate({ kind: "ingestRun", runId })}
                />
              </div>
            ) : view.kind === "insights" ? (
              <div className="min-w-0 flex-1 overflow-auto">
                <EngagementPanel slug={slug} />
              </div>
            ) : view.kind === "ingest" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <IngestPanel
                  slug={slug}
                  canEdit={canEdit}
                  isSynthesized={isSynthesized}
                  entityKind={isArea ? "area" : "bhag"}
                  onOpenRun={(runId) => navigate({ kind: "ingestRun", runId })}
                  onReviewDraft={(runId) => navigate({ kind: "draftReview", runId })}
                  onRunStarted={(runId) => navigate({ kind: "ingestRun", runId })}
                />
              </div>
            ) : view.kind === "ingestRun" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <IngestRunView
                  key={view.runId}
                  slug={slug}
                  runId={view.runId}
                  onPagesChanged={load}
                  onReviewDraft={(runId) => navigate({ kind: "draftReview", runId })}
                  canEdit={canEdit}
                />
              </div>
            ) : view.kind === "draftReview" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <DraftReviewView
                  key={view.runId}
                  slug={slug}
                  runId={view.runId}
                  canEdit={canEdit}
                  onResolved={() => {
                    void load();
                    navigate({ kind: "ingestRun", runId: view.runId });
                  }}
                />
              </div>
            ) : view.kind === "folder" ? (
              <div className="min-h-0 min-w-0 flex-1">
                {activeFolderNode ? (
                  <TreeIndex
                    icon={<FolderKanban className="h-4 w-4" />}
                    title={activeFolderNode.title}
                    description="A folder of the wiki, and the pages and subfolders kept in it."
                    nodes={activeFolderNode.children}
                    emptyNote="Pages written here, or moved here from elsewhere in the wiki, appear in this list."
                    emptyAction={canEdit
                      ? { label: "New page", onClick: () => openNewPage(activeFolderNode) }
                      : undefined}
                    onOpenPage={openPage}
                    onOpenFolder={openFolder}
                    actions={canEdit ? (
                      <>
                        <Button variant="outline" onClick={() => openEditFolder(activeFolderNode)}>
                          Edit folder
                        </Button>
                        <Button variant="outline" onClick={() => openCreateFolder(activeFolderNode.folderId ?? null)}>
                          <FolderPlus className="h-4 w-4" />
                          New subfolder
                        </Button>
                        {/* The filled one, here as on Wiki and on Notes: a
                            folder is somewhere to put a page, and a reader
                            should not have to work out which of three
                            buttons is the one they came for. */}
                        <Button onClick={() => openNewPage(activeFolderNode)}>
                          <FilePlus2 className="h-4 w-4" />
                          New page
                        </Button>
                      </>
                    ) : undefined}
                  />
                ) : (
                  <p className="p-6 text-sm text-muted-foreground">Folder not found.</p>
                )}
              </div>
            ) : view.kind === "wiki" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <TreeIndex
                  icon={<BookOpen className="h-4 w-4" />}
                  title="Wiki"
                  description="The curated pages for this space: what people wrote, and what the agent drafted from what it read."
                  nodes={wikiSplit.authored}
                  emptyNote="Pages people write, and pages the agent drafts from what it has read, collect here."
                  emptyAction={canEdit
                    ? { label: "Run an ingest", onClick: () => navigate({ kind: "ingest" }) }
                    : undefined}
                  onOpenPage={openPage}
                  onOpenFolder={openFolder}
                  actions={canEdit ? (
                    // Filled, like New note on Notes: the one thing a reader
                    // comes to an empty branch to do looks the same whichever
                    // branch they came to.
                    <Button onClick={() => openNewPage(null)}>
                      <FilePlus2 className="h-4 w-4" />
                      New page
                    </Button>
                  ) : undefined}
                />
              </div>
            ) : view.kind === "glossary" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <GlossaryView slug={slug} onOpenPage={openPage} />
              </div>
            ) : view.kind === "sources" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <SourcesIndex
                  sources={sources}
                  onOpenSource={(id) => navigate({ kind: "source", id })}
                />
              </div>
            ) : view.kind === "source" ? (
              <div className="min-h-0 min-w-0 flex-1">
                {(() => {
                  const entry =
                    sources.find((candidate) => candidate.source.id === view.id)
                      ?? sources[0];
                  const { source, nodes } = entry;
                  const withIssues = source.id === "github" && showIssuesReport;
                  return (
                    <TreeIndex
                      icon={
                        <ProviderLogo
                          provider={source.provider}
                          className="h-5 w-5 object-contain"
                        />
                      }
                      title={source.name}
                      description={source.blurb}
                      nodes={nodes}
                      // Raised in GitHub and read here, so they head the
                      // system they belong to rather than sitting among the
                      // pages mirrored from it.
                      lead={
                        withIssues ? (
                          <button
                            type="button"
                            onClick={() => navigate({ kind: "issues" })}
                            className="flex w-full items-center gap-3 border-b px-2 py-4 text-left transition-colors hover:bg-muted/60"
                          >
                            <ListChecks className="h-5 w-5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">Issues</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                Raised against the repositories this space watches
                              </span>
                            </span>
                            {railCounts.issues !== undefined && (
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {railCounts.issues}
                              </span>
                            )}
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        ) : undefined
                      }
                      leadCount={withIssues ? 1 : 0}
                      emptyNote={
                        source.unavailable
                          ? `${source.name} is not connected to this space yet. Once it is, what this space reads from it lands here.`
                          : `Nothing read from ${source.name} yet. Its pages land here once they have been read.`
                      }
                      emptyAction={canEdit
                        ? { label: "Connect a source", onClick: () => navigate({ kind: "ingest" }) }
                        : undefined}
                      onOpenPage={openPage}
                      onOpenFolder={openFolder}
                    />
                  );
                })()}
              </div>
            ) : view.kind === "related" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <PanelShell
                  title="Related projects"
                  description="The spaces tagged into the same categories as this one. Tagging happens on the By function view, where the categories are made."
                  titleAccessory={
                    <span className="text-xs font-normal text-muted-foreground">
                      {related.length} {related.length === 1 ? "space" : "spaces"}
                    </span>
                  }
                >
                  {related.length === 0 ? (
                    <TomeEmpty
                      icon={<FileSymlink />}
                      headline="Nothing tagged alongside this space"
                      hint="Tag this space into a category and everything else in that category appears here."
                      action={{ label: "Open By function", href: "/projects?tab=functions" }}
                    />
                  ) : (
                    <RelatedSpacesBlock related={related} bare />
                  )}
                </PanelShell>
              </div>
            ) : view.kind === "pageHistory" ? (
              <div className="min-h-0 min-w-0 flex-1">
                <PageHistoryView
                  slug={slug}
                  path={view.path}
                  canEdit={canEdit}
                  onReverted={load}
                  onOpenRun={(runId) => navigate({ kind: "ingestRun", runId })}
                  onReviewDraft={(runId) => navigate({ kind: "draftReview", runId })}
                />
              </div>
            ) : (
              // page
              <div className="min-h-0 min-w-0 flex-1">
                {loading ? (
                  <TomeLoading />
                ) : data && data.pages[view.path] !== undefined ? (
                  <WikiPageView
                    slug={slug}
                    path={view.path}
                    markdown={data.pages[view.path]}
                    onWrite={writeMarkdown}
                    onReload={load}
                    onOpenHistory={() =>
                      navigate({ kind: "pageHistory", path: view.path })
                    }
                    locked={locked}
                    awaitingReview={awaitingReview}
                    onNavigate={(path) => navigate({ kind: "page", path })}
                    glossaryPreview={glossaryPreview}
                    onRename={canEdit ? renamePage : undefined}
                    canEdit={canEdit}
                    knownPaths={knownPagePaths}
                    teamName={projectMeta.teamName}
                    autoStartEditing={autoEditPath === view.path}
                    onAutoStartEditing={() => setAutoEditPath(null)}
                  />
                ) : (
                  <p className="p-8 text-sm text-muted-foreground">Page not found.</p>
                )}
              </div>
            )}
          </main>
        </div>
        {/* Not on the agent view: that view is a chat, and a second one in
            the corner of it would be two chats in one place. */}
        {data && !error && view.kind !== "agent" && (
          <>
            <TomeAssistantBubble
              key={slug}
              slug={slug}
              projectTitle={projectTitle ?? undefined}
              pagePath={trackedPagePath}
              bottomInset={view.kind === "settings" ? assistantBottomInset : undefined}
            />
            {/* Stands in only where the real one is switched off, and sits
                where the real one would, so a reader who opened it on the hub
                finds it open here. */}
            <AskTomePlaceholder
              bottomInset={view.kind === "settings" ? assistantBottomInset : undefined}
            />
          </>
        )}
      </div>

      <Dialog
        open={folderDialog !== null}
        onOpenChange={(open) => {
          if (!open && !savingFolder) {
            setFolderDialog(null);
            setFolderError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveFolder();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {folderDialog?.mode === "edit" ? "Edit folder" : "New folder"}
              </DialogTitle>
              <DialogDescription>
                Folder names and hierarchy are independent from page URLs and Markdown content.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label htmlFor="tome-folder-name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="tome-folder-name"
                  value={folderDialog?.name ?? ""}
                  onChange={(event) => setFolderDialog((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )}
                  placeholder="Planning"
                  maxLength={120}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="tome-folder-parent" className="text-sm font-medium">
                  Parent folder
                </label>
                <select
                  id="tome-folder-parent"
                  value={folderDialog?.parentId ?? ""}
                  onChange={(event) => setFolderDialog((current) =>
                    current
                      ? { ...current, parentId: event.target.value || null }
                      : current,
                  )}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Wiki root</option>
                  {folderParentOptions.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.label}</option>
                  ))}
                </select>
              </div>
              {folderError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {folderError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFolderDialog(null)}
                disabled={savingFolder}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingFolder || !folderDialog?.name.trim()}>
                {savingFolder && <Loader2 className="h-4 w-4 animate-spin" />}
                {folderDialog?.mode === "edit" ? "Save changes" : "Create folder"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeletePageDialog
        path={pagePendingDelete}
        deleting={deletingPage}
        onCancel={() => setPagePendingDelete(null)}
        onConfirm={() => void confirmDeletePage()}
      />

      <DeleteFolderDialog
        name={folderPendingDelete?.name ?? null}
        deleting={deletingFolder}
        onCancel={() => setFolderPendingDelete(null)}
        onConfirm={() => void confirmDeleteWikiFolder()}
      />

      <OnboardingModal
        open={onboardingOpen}
        onOpenChange={handleOnboardingChange}
        projectName={projectTitle ?? undefined}
      />
    </TooltipProvider>
  );
}


function SidebarSkeleton() {
  const widths = ["w-3/4", "w-1/2", "w-2/3", "w-1/2", "w-3/5", "w-2/5"];
  return (
    <div className="space-y-2 px-2 py-1" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className={cn("h-4 animate-pulse rounded bg-muted", w)} />
      ))}
    </div>
  );
}
