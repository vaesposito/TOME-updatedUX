"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Bot, ImagePlus, Info, Loader2, Pencil, Trash2, UserRound, X } from "lucide-react";

import {
  MARKDOWN_DOCUMENT_EDITOR_MODES,
  MarkdownEditorModeToggle,
  type MarkdownDocumentEditorMode,
} from "@/components/shared/MarkdownEditorModeToggle";
import { MarkdownRenderer } from "@/components/shared/timeline/MarkdownRenderer";
import {
  RichCodeEditor,
  type ReactCodeMirrorRef,
} from "@/components/skills/workspace/RichCodeEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import {
  CrepeEditor,
  type CrepeEditorHandle,
  type MentionQuery,
} from "@/components/tome/CrepeEditor";
import { CustomPromptsPanel } from "@/components/tome/CustomPromptsPanel";
import { TomeMediaInsertDialog } from "@/components/tome/TomeMediaInsertDialog";
import type { GlossaryResolver } from "@/lib/tome/tome-links";
import { GlossaryFields } from "@/components/tome/GlossaryFields";
import { EdgeFields } from "@/components/tome/EdgeFields";
import { TrackedEntityFields } from "@/components/tome/TrackedEntityFields";
import {
  KindBadge,
  PAGE_KIND_DESCRIPTIONS,
  PAGE_KIND_SPECS,
} from "@/components/tome/KindBadge";
import { MentionPicker } from "@/components/tome/MentionPicker";
import { PageNotifyMenu } from "@/components/tome/PageNotifyMenu";
import { PageSpaceTags } from "@/components/tome/PageSpaceTags";
import { SpaceTagPicker } from "@/components/tome/SpaceTagPicker";
import { useTaggableSpaces } from "@/hooks/use-taggable-spaces";
import { mentionMarkdown } from "@/lib/tome/mentions";
import {
  frontmatterSpaceTags,
  spaceTagMarkdown,
  withFrontmatterSpaceTags,
} from "@/lib/tome/space-tags";
import {
  liveRevisions,
  readPageProvenance,
  relativeTime,
  type PageAuthorKind,
  type PageRevisionLike,
} from "@/lib/tome/page-provenance";
import { pageDisplayName } from "@/lib/tome/page-names";
import { PageToolbarSelect } from "@/components/tome/PageToolbarSelect";
import { WatchToggle } from "@/components/tome/WatchToggle";
import { ViewOnlyTooltip } from "@/components/tome/ViewOnlyTooltip";
import { WikiExportMenu } from "@/components/tome/WikiExportMenu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  FM_RELATION,
  FM_SOURCE,
  FM_SOURCE_PATH,
  FM_SOURCE_REPO,
  FM_TARGET,
  FM_TEMPLATE_PATH,
  FM_TEMPLATE_SCOPE,
  FM_TEMPLATE_VERSION,
  FM_TERM,
  FM_TITLE,
  isEdge,
  isGlossaryTerm,
  isMirrorPage,
  isTrackedEntity,
  parseFrontmatter,
  serializeFrontmatter,
  SPEC_BY_PATH,
  type FrontmatterValue,
} from "@/lib/tome/schema";
import { cn } from "@/lib/utils";
import { diagnoseTomeMarkdown } from "@/lib/tome/markdown-diagnostics";
import type {
  PageKind,
  PageNotifyOutcome,
  PageNotifySelection,
} from "@/types/tome";

/** User-flippable kinds (report is system-managed via path). */
const FLIPPABLE_KINDS: { key: PageKind; label: string }[] = [
  { key: "stable", label: "Stable" },
  { key: "dynamic", label: "Dynamic" },
  { key: "hidden", label: "Hidden" },
];

/** Notify nobody beyond the entity's watchers, who are always told. */
/**
 * What the notify menu starts at for every save.
 *
 * Telling the team is on: a page edited in a team's space is normally the
 * team's business. Importance is off, so the mark keeps its meaning. Tagging
 * is empty, because it names particular people and nobody can be volunteered
 * by a default.
 */
const DEFAULT_NOTIFY: PageNotifySelection = {
  team: true,
  important: false,
  users: [],
};

/**
 * Whether two markdown documents say the same thing.
 *
 * Not a byte comparison: the editor's draft has been round-tripped through
 * the frontmatter parser, which drops the blank line a page usually keeps
 * after its closing fence. Comparing raw text made an edit nobody typed into
 * look like a recovered draft, so opening the editor and walking away left
 * the page wearing a badge for work that was never done.
 */
function sameDocument(a: string, b: string): boolean {
  if (a === b) return true;
  const settle = (markdown: string) => {
    const [fm, body] = parseFrontmatter(markdown);
    return serializeFrontmatter(fm, body);
  };
  return settle(a) === settle(b);
}

/**
 * Phrase a save's notification outcome for the editor, or null when there is
 * nothing worth saying (a quiet save with no watchers).
 *
 * Someone tagged who has never signed in cannot be reached, and silently
 * dropping them would leave the editor believing a message was delivered — so
 * that case is reported as an error even when others were notified.
 */
function describeNotifyOutcome(
  outcome: PageNotifyOutcome,
  teamName?: string | null,
): { message: string; type: "success" | "error" } | null {
  const reached: string[] = [];
  if (outcome.notified > 0) {
    reached.push(`${outcome.notified} ${outcome.notified === 1 ? "person" : "people"}`);
  }
  // The server reports the team it addressed by slug; show the display name the
  // editor saw in the menu when we have it.
  if (outcome.team) reached.push(`the ${teamName || outcome.team} team`);
  const notified = reached.length > 0 ? `Notified ${reached.join(" and ")}.` : "";

  if (outcome.unresolved.length === 0) {
    return notified ? { message: notified, type: "success" } : null;
  }
  const names = outcome.unresolved.join(", ");
  const haveNot = outcome.unresolved.length === 1 ? "hasn't" : "haven't";
  return {
    type: "error",
    message: `${notified} ${names} ${haveNot} signed in to CAIPE yet, so they weren't notified.`.trim(),
  };
}

interface Props {
  slug: string;
  path: string;
  /** Current page markdown (frontmatter + body). */
  markdown: string;
  onWrite: (
    path: string,
    markdown: string,
    message: string,
    options?: {
      baseRevisionId?: string | null;
      force?: boolean;
      notify?: PageNotifySelection;
    },
  ) => Promise<PageNotifyOutcome | null | void>;
  onReload: () => void | Promise<void>;
  /** When provided, renders a close (×) button — used by the artifact pane. */
  onClose?: () => void;
  /** When provided, renders a History button opening the revision diff view. */
  onOpenHistory?: () => void;
  /**
   * Ask for this page to be removed. Expected to confirm, name what is going,
   * and take the reader somewhere that still exists.
   *
   * Offered from inside editing only: deciding a page should not exist is of
   * a piece with changing it, and someone who came to read it should not have
   * a way to delete it sitting beside the things they came to do.
   */
  onDelete?: (path: string) => void;
  /** When true, an ingest is rewriting the wiki — render read-only. */
  locked?: boolean;
  /** When true, `locked` is because a draft is awaiting review (not an active
   * ingest) — same read-only effect, different banner copy. */
  awaitingReview?: boolean;
  /** Navigate to another wiki page (internal `tome://` link click). */
  onNavigate?: (path: string) => void;
  /** Resolve a glossary term slug to its definition for the hover card. */
  glossaryPreview?: GlossaryResolver;
  /** OpenFGA steward/admin decision for all write affordances. */
  canEdit?: boolean;
  /** Current project paths used to flag broken wiki links in source mode. */
  knownPaths?: ReadonlySet<string>;
  /** Owning team, shown in the Notifications menu so "Notify team" names a team. */
  teamName?: string | null;
  /** Open a just-created page directly in editing mode. */
  autoStartEditing?: boolean;
  onAutoStartEditing?: () => void;
}

/**
 * A single wiki page: header (title + kind badge + kind toggle + edit/save) and
 * the Milkdown editor. Read-only until Edit. Used both as the main wiki view
 * and as the chat artifact pane.
 *
 * When `markdown` changes from the outside (e.g. the agent edits the page) and
 * the user isn't mid-edit, the editor remounts so the change is visible live.
 */
export function WikiPageView({
  slug,
  path,
  markdown,
  onWrite,
  onReload,
  onClose,
  onOpenHistory,
  onDelete,
  locked = false,
  awaitingReview = false,
  onNavigate,
  glossaryPreview,
  canEdit = true,
  knownPaths,
  teamName,
  autoStartEditing = false,
  onAutoStartEditing,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editorMode, setEditorMode] = useState<MarkdownDocumentEditorMode>("rich");
  const [rawDraft, setRawDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  // The markdown body fed into CrepeEditor on mount; updated when switching
  // back from raw mode so unsaved raw edits survive the remount.
  const [richInitialBody, setRichInitialBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  // What "just now" is measured against. Typing re-renders this header on its
  // own, so the clock only has to move for the writer who has stopped — who
  // is exactly the person a phrase frozen at "just now" would mislead.
  const [draftClock, setDraftClock] = useState(() => Date.now());
  const [baseRevisionId, setBaseRevisionId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    currentRevisionId: string | null;
    currentMarkdown: string;
    currentAuthor: string | null;
    currentCreatedAt: string | null;
  } | null>(null);
  // Who to tell about this edit. Reset after each save so the next edit starts
  // from a deliberate choice rather than inheriting the last one.
  const [notify, setNotify] = useState<PageNotifySelection>(DEFAULT_NOTIFY);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const { toast } = useToast();
  const editorRef = useRef<CrepeEditorHandle>(null);
  const sourceEditorRef = useRef<ReactCodeMirrorRef | null>(null);
  const previewMode = editorMode === "preview";

  // The page's live history — fetched once per page, and read into the header
  // line that says who last wrote it and what kind of writing it was. Drafts
  // and rejected drafts are dropped: they are not what is on screen, so
  // attributing the page to one would credit a change nobody can see.
  const [liveHistory, setLiveHistory] = useState<PageRevisionLike[]>([]);

  // Editing must capture the revision that exists when the editor opens. The
  // history request is asynchronous, so auto-opening a newly-created page can
  // otherwise start with a null base revision and produce a false conflict.
  const historyRequestRef = useRef<{
    key: string;
    promise: Promise<PageRevisionLike[]>;
  } | null>(null);

  const refreshLastRevision = useCallback(async () => {
    const key = `${slug}:${path}`;
    const inFlight = historyRequestRef.current;
    if (inFlight?.key === key) return inFlight.promise;

    const promise = (async () => {
      const response = await fetch(`/api/tome/projects/${slug}/history/${path}`);
      if (!response.ok) throw new Error(`history load failed (${response.status})`);
      const payload = await response.json();
      const revisions = (payload?.data?.revisions ?? []) as PageRevisionLike[];
      return liveRevisions(revisions);
    })();
    historyRequestRef.current = { key, promise };

    try {
      const revisions = await promise;
      // A page switch may have started another request while this one was in
      // flight. Only apply the result belonging to the active page.
      if (historyRequestRef.current?.promise === promise) {
        setLiveHistory(revisions);
      }
      return revisions;
    } finally {
      if (historyRequestRef.current?.promise === promise) {
        historyRequestRef.current = null;
      }
    }
  }, [path, slug]);

  useEffect(() => {
    setLiveHistory([]);
    void refreshLastRevision().catch(() => undefined);
  }, [refreshLastRevision]);

  const { frontmatter, body, kind, title } = useMemo(() => {
    const [fm, b] = parseFrontmatter(markdown);
    const f = fm as Record<string, FrontmatterValue>;
    const k = (typeof f.kind === "string"
      ? f.kind
      : (SPEC_BY_PATH.get(path)?.kind ?? "stable")) as PageKind;
    const t =
      typeof f.title === "string"
        ? f.title
        : (SPEC_BY_PATH.get(path)?.title ?? pageDisplayName(path));
    return { frontmatter: f, body: b, kind: k, title: t };
  }, [markdown, path]);
  const [draftFrontmatter, draftBody] = useMemo(() => {
    const [fm, draftBodyValue] = parseFrontmatter(rawDraft);
    return [fm as Record<string, FrontmatterValue>, draftBodyValue] as const;
  }, [rawDraft]);

  /**
   * The name the page is shown by here.
   *
   * Read from the draft while editing, so a title just typed is the title on
   * screen, and from the saved page otherwise.
   */
  const shownTitle = useMemo(() => {
    if (!isEditing) return title;
    const drafted = draftFrontmatter.title;
    return typeof drafted === "string" && drafted.trim() ? drafted : title;
  }, [draftFrontmatter.title, isEditing, title]);

  const isGlossary = useMemo(() => isGlossaryTerm(frontmatter), [frontmatter]);
  const isEdgeEntry = useMemo(() => isEdge(frontmatter), [frontmatter]);
  const isTrackedEntry = useMemo(() => isTrackedEntity(frontmatter), [frontmatter]);
  const isMirror = useMemo(() => isMirrorPage(frontmatter), [frontmatter]);
  // Read from the draft while editing so a tag just added shows immediately,
  // and from the saved page otherwise.
  const spaceTags = useMemo(
    () => frontmatterSpaceTags(isEditing ? draftFrontmatter : frontmatter),
    [draftFrontmatter, frontmatter, isEditing],
  );
  // Also fetched while reading when the page carries tags: a tag names the
  // space it points at, and the page stores only the slug.
  const taggableSpaces = useTaggableSpaces({
    enabled: isEditing || spaceTags.length > 0,
  });
  // Named for a reader, so the stored `.md` never reaches the header.
  const provenance = useMemo(() => readPageProvenance(liveHistory), [liveHistory]);

  // Template binding (#488/#508): passive, zero-extra-fetch badge read
  // straight off this page's own frontmatter (code-stamped by the ingest
  // persist hook, never agent-authored). Only says whether/at-what-version
  // this page is bound to a template; whether that version is stale and
  // whether its content has drifted is the "Check for template drift"
  // report (Templates tab), not repeated on every page load.
  const templateBinding = useMemo(() => {
    const scope = frontmatter[FM_TEMPLATE_SCOPE];
    if (!scope || scope === "null") return null;
    const templatePath = frontmatter[FM_TEMPLATE_PATH];
    const version = frontmatter[FM_TEMPLATE_VERSION];
    return {
      scope: String(scope),
      templatePath: templatePath ? String(templatePath) : null,
      version: typeof version === "number" ? version : null,
    };
  }, [frontmatter]);

  // Editable copy of the frontmatter for structured (glossary/edge) entries.
  // Kept in sync with the page's frontmatter whenever we're not mid-edit (page
  // switch / external agent edit); the Edit→Save flow mutates this draft.
  const [fmDraft, setFmDraft] = useState<Record<string, FrontmatterValue>>(frontmatter);
  useEffect(() => {
    if (!isEditing) setFmDraft(frontmatter);
  }, [frontmatter, isEditing]);

  // A whole-page tag is frontmatter, and the body may not be touched in the
  // same edit, so the raw draft is rewritten here as well as the frontmatter
  // draft — otherwise tagging and saving without typing would save nothing.
  const setSpaceTags = useCallback((slugs: string[]) => {
    setFmDraft((current) => withFrontmatterSpaceTags(current, slugs));
    setRawDraft((current) => {
      const [fm, bodyContent] = parseFrontmatter(current);
      return serializeFrontmatter(
        withFrontmatterSpaceTags(fm as Record<string, FrontmatterValue>, slugs),
        bodyContent,
      );
    });
  }, []);

  // Switching pages resets edit state.
  useEffect(() => {
    setIsEditing(false);
    setRenamingTitle(false);
    setEditorMode("rich");
    setError(null);
    setDraftStatus(null);
    setDraftSavedAt(null);
  }, [path]);

  const draftStorageKey = useMemo(
    () => `tome:draft:${slug}:${path}`,
    [path, slug],
  );

  /**
   * Whether a draft is waiting here that opening the editor would recover.
   *
   * The same test `startEditing` makes, so that what this says and what
   * happens cannot disagree: a stored body identical to the page is a
   * leftover of opening the editor and not typing, and recovers nothing.
   *
   * Read in an effect rather than while rendering, because storage does not
   * exist on the server and the two renders would not match.
   */
  const [recoverableDraft, setRecoverableDraft] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(draftStorageKey);
      const body = stored
        ? (JSON.parse(stored) as { body?: unknown }).body
        : null;
      setRecoverableDraft(
        typeof body === "string" && !sameDocument(body, markdown),
      );
    } catch {
      setRecoverableDraft(false);
    }
    // `isEditing` so the answer is re-read after a save or a cancel has
    // cleared the draft, and the Edit button comes back telling the truth.
  }, [draftStorageKey, isEditing, markdown]);

  useEffect(() => {
    if (!isEditing) return;
    const timer = window.setTimeout(() => {
      const updatedAt = new Date().toISOString();
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          body: serializeFrontmatter(fmDraft, draftBody),
          baseRevisionId,
          updatedAt,
        }),
      );
      setDraftStatus("Draft saved locally");
      setDraftSavedAt(updatedAt);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [baseRevisionId, draftBody, draftStorageKey, fmDraft, isEditing]);

  /**
   * Clear away a draft nobody typed into, when the editor goes with its page.
   *
   * One is written half a second after Edit opens, whether or not anything
   * is written in it. Cancel discards it, but navigating away does not — so
   * merely opening the editor and leaving left a draft behind that said the
   * page had unsaved work. Only ever removes one that says what the page
   * already says; a draft with something in it is the reader's.
   */
  const onLeaving = useRef({ editing: isEditing, key: draftStorageKey, markdown });
  useEffect(() => {
    onLeaving.current = { editing: isEditing, key: draftStorageKey, markdown };
  });
  useEffect(
    () => () => {
      const { editing, key, markdown: shown } = onLeaving.current;
      if (!editing) return;
      try {
        const stored = window.localStorage.getItem(key);
        if (!stored) return;
        const { body } = JSON.parse(stored) as { body?: unknown };
        if (typeof body === "string" && sameDocument(body, shown)) {
          window.localStorage.removeItem(key);
        }
      } catch {
        // No storage to tidy, or nothing readable in it.
      }
    },
    [],
  );

  // Only while there is a draft time to age. Half-minute steps are fine for a
  // phrase measured in minutes, and nothing else on screen depends on it.
  useEffect(() => {
    if (!draftSavedAt) return;
    const timer = window.setInterval(() => setDraftClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [draftSavedAt]);

  // Track content changes that landed while this page was open (an out-of-band
  // edit picked up by the polling in TomeWiki) — surfaced as a badge on the
  // History button. Reset on page switch or once the user opens History
  // (they've now seen it). `openedMarkdownRef` anchors "since open" to the
  // first markdown seen for this path, not every render.
  const openedMarkdownRef = useRef(markdown);
  const [changesSinceOpen, setChangesSinceOpen] = useState(0);
  useEffect(() => {
    // Path change: re-anchor to whatever markdown this render has. Reacting
    // to `markdown` here too would re-arm on every content change instead
    // of only on a page switch, so it's deliberately left out of deps.
    openedMarkdownRef.current = markdown;
    setChangesSinceOpen(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    if (markdown !== openedMarkdownRef.current) {
      openedMarkdownRef.current = markdown;
      setChangesSinceOpen((n) => n + 1);
    }
  }, [markdown]);

  // External change (agent edit) while not editing → remount to show it live.
  useEffect(() => {
    if (!isEditing) setEditorEpoch((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  // Ingest started mid-edit → drop to read-only (the agent now owns the page).
  useEffect(() => {
    if (locked && isEditing) {
      setIsEditing(false);
      setEditorMode("rich");
      setEditorEpoch((n) => n + 1);
    }
  }, [locked, isEditing]);

  const handleSave = useCallback(async () => {
    if (editorMode === "rich" && !editorRef.current) return;
    setSaving(true);
    setError(null);
    try {
      let fmToWrite = { ...fmDraft };
      if (isGlossary) {
        fmToWrite = { ...fmDraft };
        const term = String(fmToWrite[FM_TERM] ?? "").trim();
        if (term) fmToWrite[FM_TITLE] = term;
      } else if (isEdgeEntry) {
        fmToWrite = { ...fmDraft };
        const relation = String(fmToWrite[FM_RELATION] ?? "").trim();
        const source = String(fmToWrite[FM_SOURCE] ?? "").trim();
        const target = String(fmToWrite[FM_TARGET] ?? "").trim();
        if (relation && source && target) {
          fmToWrite[FM_TITLE] = `${source} ${relation} ${target}`;
        }
      } else if (isTrackedEntry) {
        fmToWrite = { ...fmDraft };
      }
      const bodyContent = editorMode === "rich"
        ? editorRef.current?.getMarkdown() ?? draftBody
        : draftBody;
      const md = serializeFrontmatter(fmToWrite, bodyContent);
      const outcome = await onWrite(path, md, `edit ${path}`, {
        baseRevisionId,
        notify,
      });
      // Refresh before closing the editor so the next edit starts from the
      // revision just written, rather than the previous in-memory snapshot.
      await refreshLastRevision().catch(() => undefined);
      window.localStorage.removeItem(draftStorageKey);
      setIsEditing(false);
      setEditorMode("rich");
      setDraftStatus(null);
      setDraftSavedAt(null);
      setNotify(DEFAULT_NOTIFY);
      setEditorEpoch((n) => n + 1);
      // Recipients who are looking at the app should see the bell update now
      // rather than on its next poll.
      window.dispatchEvent(new Event("in-app-notifications:refresh"));
      const told = outcome ? describeNotifyOutcome(outcome, teamName) : null;
      if (told) toast(told.message, told.type);
    } catch (e) {
      const saveError = e as Error & {
        code?: string;
        currentRevisionId?: string | null;
        currentMarkdown?: string;
        currentAuthor?: string | null;
        currentCreatedAt?: string | null;
      };
      if (saveError.code === "PAGE_EDIT_CONFLICT") {
        setConflict({
          currentRevisionId: saveError.currentRevisionId ?? null,
          currentMarkdown: saveError.currentMarkdown ?? "",
          currentAuthor: saveError.currentAuthor ?? null,
          currentCreatedAt: saveError.currentCreatedAt ?? null,
        });
      } else {
        setError(String(saveError?.message ?? e));
      }
    } finally {
      setSaving(false);
    }
  }, [baseRevisionId, draftBody, draftStorageKey, editorMode, isGlossary, isEdgeEntry, isTrackedEntry, fmDraft, notify, onWrite, path, refreshLastRevision, teamName, toast]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditorMode("rich");
    window.localStorage.removeItem(draftStorageKey);
    setDraftStatus(null);
    setDraftSavedAt(null);
    setNotify(DEFAULT_NOTIFY);
    setEditorEpoch((n) => n + 1);
  }, [draftStorageKey]);

  const handleModeChange = useCallback((nextMode: MarkdownDocumentEditorMode) => {
    if (editorMode === "rich") {
      setRawDraft(serializeFrontmatter(fmDraft, editorRef.current?.getMarkdown() ?? draftBody));
    }
    if (nextMode === "rich" && editorMode !== "rich") {
      setFmDraft(draftFrontmatter);
      setRichInitialBody(draftBody);
      setEditorEpoch((n) => n + 1);
    }
    setEditorMode(nextMode);
  }, [draftBody, draftFrontmatter, editorMode, fmDraft]);

  /**
   * The editor's own controls: which way the document is being written, and
   * in source mode the media picker that the rich editor keeps in its bar.
   * They act on the document rather than on the page, so they belong with
   * the formatting buttons rather than up beside Save.
   */
  const editorControls = (
    <>
      <MarkdownEditorModeToggle
        value={editorMode}
        options={MARKDOWN_DOCUMENT_EDITOR_MODES}
        onChange={handleModeChange}
        disabled={saving}
        ariaLabel="Tome editor mode"
        testId="tome-editor-mode-toggle"
        anchor="editor-mode"
      />
      {editorMode === "source" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setMediaOpen(true)}
          disabled={saving}
        >
          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
          Media
        </Button>
      )}
    </>
  );

  const insertMediaMarkdown = useCallback((embedMarkdown: string) => {
    if (editorMode === "rich") {
      editorRef.current?.insertMarkdown(embedMarkdown);
      return;
    }
    const view = sourceEditorRef.current?.view;
    if (view) {
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: embedMarkdown },
        selection: { anchor: selection.from + embedMarkdown.length },
      });
      view.focus();
    } else {
      setRawDraft((current) => `${current}${embedMarkdown}`);
    }
  }, [editorMode]);

  const startEditing = useCallback(async () => {
    let currentRevision: PageRevisionLike | undefined;
    try {
      // Always refresh on entry. This handles both the initial auto-edit race
      // and a revision written in another tab while this page was open.
      currentRevision = (await refreshLastRevision())[0];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load page history");
      return;
    }

    let initialMarkdown = markdown;
    let initialBase = currentRevision?.id ?? null;
    setDraftStatus(null);
    setDraftSavedAt(null);
    try {
      const stored = window.localStorage.getItem(draftStorageKey);
      if (stored) {
        const recovered = JSON.parse(stored) as {
          body?: unknown;
          baseRevisionId?: unknown;
          updatedAt?: unknown;
        };
        if (
          typeof recovered.body === "string" &&
          !sameDocument(recovered.body, markdown)
        ) {
          initialMarkdown = recovered.body;
          initialBase = typeof recovered.baseRevisionId === "string" ? recovered.baseRevisionId : initialBase;
          setDraftStatus("Recovered local draft");
          if (
            typeof recovered.updatedAt === "string" &&
            Number.isFinite(Date.parse(recovered.updatedAt))
          ) {
            setDraftSavedAt(recovered.updatedAt);
          }
        }
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    }
    const [recoveredFrontmatter, recoveredBody] = parseFrontmatter(initialMarkdown);
    setRawDraft(initialMarkdown);
    setFmDraft(recoveredFrontmatter as Record<string, FrontmatterValue>);
    setRichInitialBody(recoveredBody);
    setBaseRevisionId(initialBase);
    setEditorMode("rich");
    setEditorEpoch((n) => n + 1);
    setIsEditing(true);
  }, [draftStorageKey, markdown, refreshLastRevision]);

  useEffect(() => {
    if (!autoStartEditing || isEditing || !canEdit || locked) return;
    void startEditing();
    onAutoStartEditing?.();
  }, [autoStartEditing, canEdit, isEditing, locked, onAutoStartEditing, startEditing]);

  const forceSave = useCallback(async () => {
    if (!conflict) return;
    setSaving(true);
    try {
      const bodyContent = editorMode === "rich"
        ? editorRef.current?.getMarkdown() ?? draftBody
        : draftBody;
      await onWrite(
        path,
        serializeFrontmatter(fmDraft, bodyContent),
        `resolve edit conflict on ${path}`,
        { baseRevisionId: conflict.currentRevisionId, force: true },
      );
      await refreshLastRevision().catch(() => undefined);
      window.localStorage.removeItem(draftStorageKey);
      setConflict(null);
      setIsEditing(false);
      setEditorMode("rich");
      setDraftStatus(null);
      setDraftSavedAt(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [conflict, draftBody, draftStorageKey, editorMode, fmDraft, onWrite, path, refreshLastRevision]);

  const startTitleRename = useCallback(() => {
    setTitleDraft(shownTitle);
    setRenamingTitle(true);
  }, [shownTitle]);

  /** Leave the field without taking what was typed in it. */
  const cancelTitleRename = useCallback(() => {
    setRenamingTitle(false);
  }, []);

  /**
   * Take the typed name into the edit in progress.
   *
   * The name goes into the frontmatter draft and is saved by the same Save
   * that saves the body, so a title and the paragraph explaining it land
   * together and abandoning the edit abandons both.
   *
   * It is the page's `title` — what the tree, this header and the breadcrumb
   * all read it by. The page's path is its address and is deliberately left
   * alone: links already written to this page keep resolving, and no filename
   * is put in front of a reader.
   */
  const commitTitleRename = useCallback(() => {
    const next = titleDraft.trim();
    setRenamingTitle(false);
    if (!next || next === shownTitle) return;
    setFmDraft((current) => ({ ...current, title: next }));
    setRawDraft((current) => {
      const [fm, bodyContent] = parseFrontmatter(current);
      return serializeFrontmatter(
        { ...(fm as Record<string, FrontmatterValue>), title: next },
        bodyContent,
      );
    });
  }, [shownTitle, titleDraft]);

  const handleChangeKind = useCallback(
    async (newKind: PageKind) => {
      if (newKind === kind) return;
      setError(null);
      try {
        const md = serializeFrontmatter({ ...frontmatter, kind: newKind }, body);
        await onWrite(path, md, `set kind=${newKind} on ${path}`);
        await onReload();
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [kind, frontmatter, body, onWrite, onReload, path],
  );

  const dynamicWarning =
    kind === "dynamic" && isEditing
      ? "Heads up: the agent rewrites this page on every reingest. Your edits go in as context for the next rewrite, but they may not survive verbatim."
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b px-5 py-3">
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-60 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-center gap-2" data-testid="tome-page-title-row">
            {renamingTitle ? (
              <Input
                aria-label="Page title"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitTitleRename();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelTitleRename();
                  }
                }}
                onBlur={commitTitleRename}
                className="h-auto min-w-0 flex-1 border-0 px-0 py-0 text-base font-semibold leading-tight shadow-none focus-visible:ring-0"
                autoFocus
              />
            ) : (
              <div className="group/title flex min-w-0 items-center gap-1.5">
                <h2 className="min-w-0 truncate text-base font-semibold leading-tight">{shownTitle}</h2>
                {isEditing && canEdit && !locked && !isMirror && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={startTitleRename}
                        aria-label="Rename page"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-focus-within/title:opacity-100 group-hover/title:opacity-100 disabled:opacity-40"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Rename page
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
            {/* Both of these report; neither is pressable. So they are set as
                text, at the weight everything else in this header that only
                informs is set at. As pills they read as the brightest things
                in the row and drew the eye away from the buttons. */}
            {isEditing && draftStatus && (
              <p
                className="min-w-0 truncate text-[11px] text-muted-foreground"
                data-testid="tome-draft-status"
              >
                <span>{draftStatus}</span>
                {draftSavedAt && (
                  <>
                    {" · "}
                    {/* Minutes, not seconds, and the same words the line
                        below uses for the page's own history: to the second
                        is what a machine logs, and nobody reads a clock to
                        find out whether their typing is safe. The instant
                        itself stays in the title for anyone who wants it. */}
                    <time
                      dateTime={draftSavedAt}
                      title={new Date(draftSavedAt).toLocaleString()}
                    >
                      {relativeTime(draftSavedAt, new Date(draftClock))}
                    </time>
                  </>
                )}
              </p>
            )}
            {dynamicWarning && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="flex shrink-0 cursor-help items-center gap-1 text-[11px] text-muted-foreground"
                    data-testid="tome-dynamic-warning"
                  >
                    {/* The one place colour is still spent here: being told
                        your words may be rewritten is worth catching, and a
                        small amber mark catches it without the sentence
                        shouting over the controls beside it. */}
                    <AlertTriangle
                      className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-500"
                      aria-hidden="true"
                    />
                    Agent rewrites on ingest
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-80 whitespace-normal text-[11px]">
                  {dynamicWarning}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div
            className="flex min-w-0 items-center gap-1.5 overflow-hidden"
            data-testid="tome-page-metadata-row"
          >
            {provenance && onOpenHistory && !isEditing && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setChangesSinceOpen(0);
                    onOpenHistory();
                  }}
                  // `truncate` belongs on the text alone: a global rule forces
                  // anything wearing it to `display: block`, which would drop
                  // the icon onto a line of its own above its own sentence.
                  className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-left text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  // The handle behind the shown name, and the exact instant
                  // behind the relative one, for anyone who needs them.
                  title={`${provenance.latest.author} · ${new Date(provenance.latest.at).toLocaleString()} — open revision history`}
                  data-testid="tome-page-last-update"
                >
                  {changesSinceOpen > 0 && (
                    <span className="mr-1 inline-block rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                      {changesSinceOpen} new
                    </span>
                  )}
                  <UpdateIcon kind={provenance.latest.kind} />
                  <span className="min-w-0 truncate">
                    {provenance.latest.attribution} {provenance.latest.when}
                  </span>
                </button>
                {/* The agent having written last does not mean nobody has
                    ever edited the page, and a reader deciding whether to
                    trust it wants both dates. */}
                {provenance.lastEdit && (
                  <>
                    <span className="shrink-0 text-[11px] text-muted-foreground/40">·</span>
                    <span
                      className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground"
                      title={`${provenance.lastEdit.author} · ${new Date(provenance.lastEdit.at).toLocaleString()}`}
                      data-testid="tome-page-last-edit"
                    >
                      <UpdateIcon kind={provenance.lastEdit.kind} />
                      <span className="min-w-0 truncate">
                        {provenance.lastEdit.attribution} {provenance.lastEdit.when}
                      </span>
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div
          className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2"
          data-testid="tome-page-actions"
        >
          {/* Only the positive case is worth a chip: which template seeded
              this page. Not being bound to one is the ordinary case and says
              nothing a reader can act on. */}
          {templateBinding && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="cursor-default border-muted-foreground/30 text-[10px] font-medium normal-case text-muted-foreground"
                >
                  {`template v${templateBinding.version ?? "?"}`}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64 whitespace-normal text-[11px]">
                Seeded from the <code>{templateBinding.scope}</code> template&apos;s{" "}
                <code>{templateBinding.templatePath}</code> at version {templateBinding.version ?? "unknown"}.
                Run &quot;Check for template drift&quot; (Templates tab) to see whether it&apos;s current.
              </TooltipContent>
            </Tooltip>
          )}
          {isMirror && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="cursor-default text-[10px] font-medium uppercase tracking-wide border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/30 dark:text-amber-300"
                >
                  mirror
                </Badge>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="flex w-64 flex-col gap-1 whitespace-normal text-[11px] font-normal normal-case leading-relaxed"
              >
                <span className="text-xs font-semibold">Verbatim mirror</span>
                <span className="opacity-70">
                  Copied byte-for-byte from{" "}
                  <code>{String(frontmatter[FM_SOURCE_REPO] ?? "")}</code>
                  {"'s "}
                  <code>{String(frontmatter[FM_SOURCE_PATH] ?? "")}</code>. Re-mirrored
                  every ingest: edits here don&apos;t stick unless the source file
                  changes.
                </span>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Which spaces this whole page belongs to. Beside the kind badge
              because both are claims the page makes about itself rather than
              things the current reader is doing to it. */}
          <PageSpaceTags
            tags={spaceTags}
            spaces={taggableSpaces}
            editing={isEditing}
            disabled={saving}
            onChange={setSpaceTags}
          />
          {/* Whether the next ingest may overwrite what you are reading is a
              property of the page, not of your permission to change it — so
              a reader who cannot flip the kind still sees it. */}
          {canEdit && !locked && !isMirror && kind !== "report" ? (
            <KindToggle currentKind={kind} onChange={handleChangeKind} />
          ) : (
            <KindBadge kind={kind} />
          )}
          {!isEditing && (
            <>
              {/* Watching one page, rather than the whole space, for people
                  who care about a single document. */}
              <WatchToggle slug={slug} pagePath={path} className="h-7 text-xs" />
              <WikiExportMenu
                slug={slug}
                path={path}
                title={title}
                triggerClassName="border border-border p-1.5"
              />
            </>
          )}
          {isEditing ? (
            <>
              {/* With the other pickers rather than among the buttons that
                  commit: who hears about this edit is chosen the same way the
                  page's spaces and its kind are, and it used to sit between
                  Delete and Cancel, splitting the one group in the row whose
                  members really do belong together. */}
              <PageNotifyMenu value={notify} onChange={setNotify} disabled={saving} />
              {/* The three things that end the edit, kept as one cluster at
                  the end of the row so there is one place to look for them. */}
              <div className="flex items-center gap-1" data-testid="tome-page-edit-actions">
                {/* Withheld on the same terms as every other write — a mirror
                    is rewritten from its source every ingest, so deleting
                    this copy would delete nothing. */}
                {onDelete && canEdit && !locked && !isMirror && (
                  <>
                    <button
                      type="button"
                      data-tour="page-delete"
                      onClick={() => onDelete(path)}
                      disabled={saving}
                      title={`Delete ${shownTitle}`}
                      className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                    {/* Discarding the page is not the third option beside
                        keeping and abandoning this edit, so it is in the
                        cluster but not in the pair: the rule says near, and
                        the gap says not the same. */}
                    <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
                  </>
                )}
                <button
                  type="button"
                  data-tour="page-cancel"
                  // Empty says "do not press me" to the walkthrough, which
                  // presses Cancel to leave a step that opened the editor.
                  // Once there is something here that was typed, leaving the
                  // editor open is the lesser harm by a long way.
                  data-tour-undo={
                    sameDocument(serializeFrontmatter(fmDraft, draftBody), markdown)
                      ? undefined
                      : ""
                  }
                  onClick={handleCancel}
                  disabled={saving}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          ) : (
            <ViewOnlyTooltip viewOnly={!canEdit}>
              <button
                type="button"
                data-tour="page-edit"
                // What the walkthrough presses to put this back, since there
                // is no second press of Edit: it is replaced by the cluster
                // that ends the edit. Empty while a draft of the reader's is
                // waiting here, because Cancel would discard it — the tour
                // then asks them to press Edit instead of doing it for them.
                data-tour-undo={recoverableDraft ? "" : "page-cancel"}
                onClick={startEditing}
                disabled={locked || !canEdit || isMirror}
                title={
                  isMirror
                    ? "Verbatim mirror of the source repo's .tome/pages file: edit it there instead, this copy is overwritten on every ingest"
                    : canEdit && locked
                      ? awaitingReview
                        ? "A draft is awaiting review: approve or reject it before editing"
                        : "Ingest in progress: the wiki is read-only"
                      : undefined
                }
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                Edit
              </button>
            </ViewOnlyTooltip>
          )}
        </div>
      </div>

      {locked && (
        <p className="flex items-center gap-2 border-b bg-amber-500/10 px-5 py-2 text-sm text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {awaitingReview
            ? "A draft is awaiting review: the wiki is read-only until it's approved or rejected."
            : "Ingest in progress: the wiki is read-only until it finishes."}
        </p>
      )}

      {error && (
        <p className="border-b bg-destructive/10 px-5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {isGlossary && (
        <>
          <GlossaryFields
            value={isEditing ? fmDraft : frontmatter}
            editing={isEditing && !previewMode}
            onChange={setFmDraft}
          />
          <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Definition
          </div>
        </>
      )}

      {isEdgeEntry && (
        <>
          <EdgeFields
            value={isEditing ? fmDraft : frontmatter}
            editing={isEditing && !previewMode}
            onChange={setFmDraft}
          />
          <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Explanation
          </div>
        </>
      )}

      {isTrackedEntry && (
        <>
          <TrackedEntityFields
            value={isEditing ? fmDraft : frontmatter}
            editing={isEditing && !previewMode}
            onChange={setFmDraft}
          />
          <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Context and evidence
          </div>
        </>
      )}

      {/* The editor, ring and all. What configures how the page gets written
          belongs inside that ring, below the writing area, rather than beside
          it: the ring is what tells a reader where the editing starts. */}
      <div
        data-testid="tome-page-editor"
        className={cn(
          "flex min-h-0 flex-1 flex-col transition-shadow",
          isEditing &&
            "ring-2 ring-inset ring-amber-400/70 dark:ring-amber-700/60",
        )}
      >
        {/* Markdown and Preview have no bar of their own, so they draw one
            where the rich editor's sits, rather than letting the controls
            jump to the header whenever the mode changes. */}
        {isEditing && editorMode !== "rich" && (
          <div className="flex items-center justify-end gap-1 border-b bg-muted/20 px-2 py-1">
            {editorControls}
          </div>
        )}
        <ScrollArea
          data-testid="tome-page-editor-scroll"
          className="min-h-0 flex-1"
        >
          <div
            className={cn(isEditing && editorMode === "rich" && "tome-rich-editor-full-width")}
          >
            {/* Rich mode has a formatting bar to sit under, and gets this
                through the editor itself; the other two modes have the bar
                drawn above, so the panel simply follows it here. */}
            {isEditing && kind === "dynamic" && editorMode !== "rich" && (
              <CustomPromptsPanel />
            )}
            {isEditing && editorMode === "source" ? (
              <div className="h-full min-h-[28rem] p-3">
                <RichCodeEditor
                  editorRef={sourceEditorRef}
                  value={rawDraft}
                  onChange={(nextMarkdown) => {
                    setRawDraft(nextMarkdown);
                    const [nextFrontmatter] = parseFrontmatter(nextMarkdown);
                    setFmDraft(nextFrontmatter as Record<string, FrontmatterValue>);
                  }}
                  filename={path}
                  language="markdown"
                  wrap
                  fillContainer
                  lintSource={(value) => diagnoseTomeMarkdown(value, { knownPaths })}
                  className="h-full"
                />
              </div>
            ) : isEditing && previewMode ? (
              <MarkdownRenderer
                content={draftBody}
                variant="final"
                className="tome-document-preview px-8 py-6"
                onInternalLink={onNavigate}
                glossaryPreview={glossaryPreview}
                enableExternalEmbeds
                enableExcalidraw
                enableMermaid
                enableTomeColumns
              />
            ) : !isEditing ? (
              <MarkdownRenderer
                content={body}
                variant="final"
                className="tome-document-preview px-8 py-6"
                onInternalLink={onNavigate}
                glossaryPreview={glossaryPreview}
                enableExternalEmbeds
                enableExcalidraw
                enableMermaid
                enableTomeColumns
              />
            ) : (
              <CrepeEditor
                key={`${slug}-${path}-${editorEpoch}`}
                ref={editorRef}
                initialMarkdown={richInitialBody}
                readonly={false}
                onChange={(nextBody) => setRawDraft(serializeFrontmatter(fmDraft, nextBody))}
                onNavigate={onNavigate}
                glossaryPreview={glossaryPreview}
                hideHtmlComments
                onInsertMedia={() => setMediaOpen(true)}
                onMentionQuery={setMentionQuery}
                enableColumns
                toolbarExtras={editorControls}
                documentHeader={kind === "dynamic" ? <CustomPromptsPanel /> : undefined}
              />
            )}
          </div>
        </ScrollArea>
      </div>
      {/* One `#` trigger, one picker over real spaces: a tag typed as free
          text could name a space that does not exist, and would then be
          indexed against a slug no reader can ever stand in. */}
      <SpaceTagPicker
        spaces={taggableSpaces}
        query={mentionQuery?.sigil === "#" ? mentionQuery : null}
        onCancel={() => setMentionQuery(null)}
        onPick={(space) => {
          setMentionQuery(null);
          editorRef.current?.completeMention(spaceTagMarkdown(space));
        }}
      />
      <MentionPicker
        query={mentionQuery?.sigil === "@" ? mentionQuery : null}
        onCancel={() => setMentionQuery(null)}
        onPick={(person, note) => {
          setMentionQuery(null);
          editorRef.current?.completeMention(mentionMarkdown(person));
          // Tagging someone in the body is itself the request to tell them, so
          // the save carries them whether or not the toolbar menu was opened.
          // Re-tagging replaces the earlier entry rather than duplicating it.
          setNotify((current) => ({
            ...current,
            users: [
              ...current.users.filter((picked) => picked.email !== person.email),
              { ...person, ...(note ? { note } : {}) },
            ],
          }));
        }}
      />
      <TomeMediaInsertDialog
        open={mediaOpen}
        onOpenChange={setMediaOpen}
        onInsert={insertMediaMarkdown}
      />
      <Dialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Resolve editing conflict</DialogTitle>
            <DialogDescription>
              {conflict?.currentAuthor
                ? `${conflict.currentAuthor} saved a newer revision while you were editing.`
                : "A newer revision was saved while you were editing."}
              {" "}Review both versions before choosing which one should become the next revision.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[55vh] gap-3 overflow-auto md:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Your draft</p>
              <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{rawDraft}</pre>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Latest saved version</p>
              <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{conflict?.currentMarkdown}</pre>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConflict(null);
                handleCancel();
                void onReload();
              }}
            >
              Reload latest
            </Button>
            <Button type="button" onClick={() => void forceSave()} disabled={saving}>
              Keep my version as new revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Whose hand a change came from, said with an icon before the words. */
function UpdateIcon({ kind }: { kind: PageAuthorKind }) {
  if (kind === "person") {
    return <UserRound className="h-3 w-3 shrink-0" aria-hidden="true" />;
  }
  return (
    <Bot
      className="h-3 w-3 shrink-0 text-sky-600 dark:text-sky-400"
      aria-hidden="true"
    />
  );
}

/** Popover to flip the page kind among stable / dynamic / hidden. */
function KindToggle({
  currentKind,
  onChange,
}: {
  currentKind: PageKind;
  onChange: (kind: PageKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const spec = PAGE_KIND_SPECS[currentKind];
  const { Icon } = spec;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* The kind used to be carried by a filled, colour-coded pill, which
            made the one control in the row that only opens a list look like
            the most pressable thing in it. The kind still has to be readable
            without opening anything, so it moves into the label and the
            kind's own mark — which is where the tree already reads it from —
            and the colour is spent on that mark alone. */}
        <PageToolbarSelect
          open={open}
          active
          icon={<Icon className={cn("h-3 w-3 shrink-0", spec.iconClass)} aria-hidden="true" />}
          className="uppercase tracking-wide"
          title={`${spec.title} page — ${spec.description} Click to change.`}
        >
          {spec.label}
        </PageToolbarSelect>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <p className="mb-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          Change kind
        </p>
        <div className="grid gap-1">
          {FLIPPABLE_KINDS.map((o) => (
            <div
              key={o.key}
              className={cn(
                "flex items-center rounded text-sm transition-colors hover:bg-muted",
                o.key === currentKind && "bg-muted",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left"
              >
                <span className="flex items-center gap-2">
                  <KindBadge kind={o.key} iconOnly />
                  <span>{o.label}</span>
                </span>
                {o.key === currentKind && (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    current
                  </span>
                )}
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`About ${o.label} pages`}
                    className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="w-72 whitespace-normal text-[11px] font-normal leading-relaxed"
                >
                  <span className="font-semibold">{o.label}</span>
                  <span className="ml-1 opacity-80">
                    {PAGE_KIND_DESCRIPTIONS[o.key]}
                  </span>
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
