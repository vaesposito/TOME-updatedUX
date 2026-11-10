"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ImagePlus,
  Info,
  Link2,
  Loader2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CrepeEditor, type CrepeEditorHandle } from "@/components/tome/CrepeEditor";
import { TomeLoading } from "@/components/tome/TomeLoading";
import { TomeMediaInsertDialog } from "@/components/tome/TomeMediaInsertDialog";
import { WikiExportMenu } from "@/components/tome/WikiExportMenu";
import { defaultGistFilename, normalizeGistFilename } from "@/lib/tome/gists";
import { diagnoseTomeMarkdown } from "@/lib/tome/markdown-diagnostics";
import { readJsonOrError } from "@/lib/safe-json";
import { cn } from "@/lib/utils";
import type { GistRecord } from "@/types/tome";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

type GistApiResponse = {
  data?: { gist?: GistRecord };
  error?: { message?: string };
};

async function readGistResponse(
  response: Response,
  fallbackMessage: string,
): Promise<GistRecord> {
  const parsed = await readJsonOrError<GistApiResponse>(response);
  if (!parsed.ok) {
    if (response.status === 413) {
      throw new Error(
        "This note is too large to save. Remove an embedded image or use a smaller image, then try again.",
      );
    }
    throw new Error(
      `${fallbackMessage} (${response.status}). The server returned an unexpected response.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      parsed.data.error?.message || `${fallbackMessage} (${response.status})`,
    );
  }
  const gist = parsed.data.data?.gist;
  if (!gist) {
    throw new Error(`${fallbackMessage}: the server response did not include the note.`);
  }
  return gist;
}

/** A gist read or edited in the same full-page Markdown workspace as a wiki page. */
export function GistView({
  slug,
  id,
  canEdit,
  onBack,
  onCreated,
}: {
  slug: string;
  /** Omit for the dedicated new-gist editor. */
  id?: string;
  canEdit: boolean;
  onBack: () => void;
  onCreated?: (id: string) => void;
}) {
  const creating = id === undefined;
  const [gist, setGist] = useState<GistRecord | null>(null);
  const [loading, setLoading] = useState(!creating);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(creating);
  const [editorMode, setEditorMode] = useState<MarkdownDocumentEditorMode>("rich");
  const [rawDraft, setRawDraft] = useState("");
  const [richInitialBody, setRichInitialBody] = useState("");
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [title, setTitle] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  const [filename, setFilename] = useState("gist.md");
  const [filenameCustomized, setFilenameCustomized] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const editorRef = useRef<CrepeEditorHandle>(null);
  const sourceEditorRef = useRef<ReactCodeMirrorRef | null>(null);

  const draftStorageKey = useMemo(
    () => `tome:gist-draft:${slug}:${id ?? "new"}`,
    [id, slug],
  );

  const loadEditorDraft = useCallback((source?: GistRecord) => {
    let nextTitle = source?.title ?? "";
    let nextFilename = source?.filename ?? defaultGistFilename(nextTitle);
    let nextBody = source?.body ?? "";
    let nextTags = source?.tags ?? [];
    let recoveredFilename = false;
    setDraftStatus(null);
    setDraftSavedAt(null);
    try {
      const stored = window.localStorage.getItem(draftStorageKey);
      if (stored) {
        const recovered = JSON.parse(stored) as {
          title?: unknown;
          filename?: unknown;
          body?: unknown;
          tags?: unknown;
          updatedAt?: unknown;
        };
        if (typeof recovered.title === "string") nextTitle = recovered.title;
        if (typeof recovered.filename === "string") {
          nextFilename = recovered.filename;
          recoveredFilename = true;
        }
        if (typeof recovered.body === "string") nextBody = recovered.body;
        if (Array.isArray(recovered.tags)) {
          nextTags = recovered.tags.filter((tag): tag is string => typeof tag === "string");
        }
        setDraftStatus("Recovered local draft");
        if (
          typeof recovered.updatedAt === "string" &&
          Number.isFinite(Date.parse(recovered.updatedAt))
        ) {
          setDraftSavedAt(recovered.updatedAt);
        }
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    }
    setTitle(nextTitle);
    setTitleDraft(nextTitle);
    setRenamingTitle(false);
    setFilename(nextFilename);
    setFilenameCustomized(Boolean(source?.filename) || recoveredFilename);
    setRawDraft(nextBody);
    setRichInitialBody(nextBody);
    setTags(nextTags);
    setTagDraft("");
    setError(null);
    setEditorMode("rich");
    setEditorEpoch((current) => current + 1);
    setEditing(true);
  }, [draftStorageKey]);

  useEffect(() => {
    if (creating && editing && !filenameCustomized) {
      setFilename(defaultGistFilename(title));
    }
  }, [creating, editing, filenameCustomized, title]);

  useEffect(() => {
    let cancelled = false;
    setGist(null);
    setError(null);
    setDeleting(false);
    setRenamingTitle(false);
    setTitleSaving(false);
    setEditorMode("rich");
    setDraftStatus(null);
    setDraftSavedAt(null);

    if (!id) {
      setLoading(false);
      loadEditorDraft();
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setEditing(false);
    fetch(`/api/tome/projects/${slug}/gists/${id}`)
      .then(async (response) => {
        return readGistResponse(response, "Failed to load note");
      })
      .then((loadedGist) => {
        if (!cancelled) setGist(loadedGist);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, loadEditorDraft, slug]);

  useEffect(() => {
    if (!editing) return;
    const timer = window.setTimeout(() => {
      const hasDraftContent = Boolean(
        title.trim() || rawDraft.trim() || tags.length ||
          (filenameCustomized && filename !== defaultGistFilename(title)),
      );
      if (!hasDraftContent) {
        window.localStorage.removeItem(draftStorageKey);
        setDraftStatus(null);
        setDraftSavedAt(null);
        return;
      }
      const updatedAt = new Date().toISOString();
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({ title, filename, body: rawDraft, tags, updatedAt }),
      );
      setDraftStatus("Saved locally");
      setDraftSavedAt(updatedAt);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draftStorageKey, editing, filename, filenameCustomized, rawDraft, tags, title]);

  const beginEditing = useCallback(() => {
    if (gist) loadEditorDraft(gist);
  }, [gist, loadEditorDraft]);

  const cancelEditing = useCallback(() => {
    window.localStorage.removeItem(draftStorageKey);
    setDraftStatus(null);
    setDraftSavedAt(null);
    setTagDraft("");
    setRenamingTitle(false);
    setError(null);
    setEditorMode("rich");
    setEditorEpoch((current) => current + 1);
    if (creating) {
      onBack();
    } else {
      setEditing(false);
    }
  }, [creating, draftStorageKey, onBack]);

  const handleModeChange = useCallback((nextMode: MarkdownDocumentEditorMode) => {
    if (editorMode === "rich") {
      setRawDraft(editorRef.current?.getMarkdown() ?? rawDraft);
    }
    if (nextMode === "rich" && editorMode !== "rich") {
      setRichInitialBody(rawDraft);
      setEditorEpoch((current) => current + 1);
    }
    setEditorMode(nextMode);
  }, [editorMode, rawDraft]);

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

  const commitTagDraft = useCallback(() => {
    const tag = tagDraft.trim();
    setTagDraft("");
    if (tag && !tags.includes(tag)) setTags((current) => [...current, tag]);
  }, [tagDraft, tags]);

  const startTitleRename = useCallback(() => {
    const current = editing ? title : gist?.title ?? title;
    setTitle(current);
    setTitleDraft(current);
    setRenamingTitle(true);
  }, [editing, gist, title]);

  const cancelTitleRename = useCallback(() => {
    setTitleDraft(editing ? title : gist?.title ?? title);
    setRenamingTitle(false);
  }, [editing, gist, title]);

  const commitTitleRename = useCallback(async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setError("Title must not be empty");
      return;
    }

    const currentTitle = editing ? title : gist?.title ?? title;
    if (nextTitle === currentTitle) {
      setRenamingTitle(false);
      return;
    }
    if (creating || editing || !id) {
      setTitle(nextTitle);
      setTitleDraft(nextTitle);
      setRenamingTitle(false);
      setError(null);
      return;
    }

    setTitleSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/tome/projects/${slug}/gists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      const updatedGist = await readGistResponse(response, "Failed to rename note");
      setGist(updatedGist);
      setTitle(updatedGist.title);
      setTitleDraft(updatedGist.title);
      setRenamingTitle(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTitleSaving(false);
    }
  }, [creating, editing, gist, id, slug, title, titleDraft]);

  const save = useCallback(async () => {
    if (!title.trim()) return;
    let normalizedFilename: string;
    try {
      normalizedFilename = normalizeGistFilename(filename);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    }
    const body = editorMode === "rich"
      ? editorRef.current?.getMarkdown() ?? rawDraft
      : rawDraft;
    if (!body.trim()) return;
    const pendingTag = tagDraft.trim();
    const nextTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;
    setSaving(true);
    setError(null);
    try {
      const endpoint = creating
        ? `/api/tome/projects/${slug}/gists`
        : `/api/tome/projects/${slug}/gists/${id}`;
      const response = await fetch(endpoint, {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          filename: normalizedFilename,
          body,
          tags: nextTags,
        }),
      });
      const savedGist = await readGistResponse(
        response,
        `Failed to ${creating ? "create" : "update"} note`,
      );
      window.localStorage.removeItem(draftStorageKey);
      setGist(savedGist);
      setFilename(savedGist.filename ?? defaultGistFilename(savedGist.title));
      setEditing(false);
      setEditorMode("rich");
      setTagDraft("");
      setDraftStatus(null);
      setDraftSavedAt(null);
      setEditorEpoch((current) => current + 1);
      if (creating) onCreated?.(savedGist.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }, [creating, draftStorageKey, editorMode, filename, id, onCreated, rawDraft, slug, tagDraft, tags, title]);

  const remove = useCallback(async () => {
    if (!gist || !id) return;
    if (!window.confirm(`Delete note "${gist.title}"?`)) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/tome/projects/${slug}/gists/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Delete failed (${response.status})`);
      }
      onBack();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setDeleting(false);
    }
  }, [gist, id, onBack, slug]);

  const canChange = creating || canEdit;

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-center gap-2 border-b px-4 py-2.5"
        data-testid="gist-editor-header"
      >
        <Button variant="ghost" size="sm" className="h-auto gap-1.5 px-2 py-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Notes
        </Button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {gist && !editing && id && (
            <>
              <CopyButton
                value={() => `${window.location.origin}/projects/${slug}/tome/gists/${id}`}
                label="Share"
                copiedLabel="Link copied"
                icon={Link2}
                size="sm"
                className="h-auto px-2 py-1 text-muted-foreground"
              >
                Share
              </CopyButton>
              <CopyButton
                value={() => gist.body}
                label="Copy page"
                copiedLabel="Copied"
                size="sm"
                className="h-auto px-2 py-1 text-muted-foreground"
              >
                Copy page
              </CopyButton>
              <WikiExportMenu
                slug={slug}
                gist={{ id, title: gist.title, filename: gist.filename }}
                triggerClassName="border border-border p-1.5"
              />
            </>
          )}
          {editing ? (
            <>
              <MarkdownEditorModeToggle
                value={editorMode}
                options={MARKDOWN_DOCUMENT_EDITOR_MODES}
                onChange={handleModeChange}
                disabled={saving}
                ariaLabel="Note editor mode"
                testId="gist-editor-mode-toggle"
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
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || titleSaving || !title.trim() || !rawDraft.trim()}
                className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? "Saving…" : creating ? "Create note" : "Save"}
              </button>
            </>
          ) : gist && canChange ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto gap-1.5 px-2 py-1 text-muted-foreground"
                onClick={beginEditing}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto gap-1.5 px-2 py-1 text-muted-foreground hover:text-destructive"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error && (
        <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
      )}

      <ScrollArea
        className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!flex [&_[data-radix-scroll-area-viewport]>div]:min-h-full [&_[data-radix-scroll-area-viewport]>div]:flex-col"
        data-testid="gist-scroll-area"
      >
        {loading ? (
          <TomeLoading />
        ) : !gist && !creating ? (
          <div className="p-8 text-sm text-muted-foreground">Note not found.</div>
        ) : (
          <div
            className="flex min-h-full w-full flex-1 flex-col"
            data-testid="gist-content-layout"
          >
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3"
              data-testid="gist-title-tags-row"
            >
              <div className="min-w-48 flex-1">
                {renamingTitle ? (
                  <Input
                    aria-label="Note title"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitTitleRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelTitleRename();
                      }
                    }}
                    onBlur={() => void commitTitleRename()}
                    placeholder="Untitled note"
                    className="h-auto w-full border-0 px-0 py-0 text-2xl font-semibold leading-tight shadow-none focus-visible:ring-0"
                    autoFocus
                    disabled={titleSaving}
                  />
                ) : (
                  <div className="group/title flex min-w-0 items-center gap-1.5">
                    <h1 className="truncate text-2xl font-semibold leading-tight">
                      {editing ? title.trim() || "Untitled note" : gist?.title}
                    </h1>
                    {canChange && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={startTitleRename}
                            disabled={titleSaving}
                            aria-label="Rename note title"
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 outline-none transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover/title:opacity-100 md:group-focus-within/title:opacity-100 disabled:opacity-40"
                          >
                            {titleSaving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          Rename note title
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
                {gist && !creating && (
                  <div
                    className="mt-0.5 flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground"
                    data-testid="gist-author-meta"
                  >
                    <span className="truncate">{gist.author}</span>
                    <span aria-hidden="true">·</span>
                    <span>modified {timeLabel(gist.updated_at ?? gist.created_at)}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="View note creation and modification details"
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Info className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        className="w-80 max-w-[calc(100vw-2rem)] whitespace-normal p-3 text-left"
                      >
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                          <dt className="font-medium text-muted-foreground">Created</dt>
                          <dd>{timeLabel(gist.created_at)}</dd>
                          <dt className="font-medium text-muted-foreground">Created by</dt>
                          <dd className="break-all">{gist.author}</dd>
                          <dt className="font-medium text-muted-foreground">Last modified</dt>
                          <dd>
                            {gist.updated_at
                              ? timeLabel(gist.updated_at)
                              : "Not modified since creation"}
                          </dd>
                          {gist.updated_at && (
                            <>
                              <dt className="font-medium text-muted-foreground">Modified by</dt>
                              <dd className="break-all">{gist.updated_by ?? gist.author}</dd>
                            </>
                          )}
                        </dl>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
              {editing && draftStatus && (
                <p
                  className="min-w-0 truncate rounded bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300"
                  data-testid="gist-draft-status"
                  role="status"
                  aria-live="polite"
                  title={
                    creating
                      ? "Saved in this browser until you create the note."
                      : "Saved in this browser as a local edit."
                  }
                >
                  <span>{draftStatus}</span>
                  {draftSavedAt && (
                    <>
                      {" · Last saved "}
                      <time dateTime={draftSavedAt}>
                        {new Date(draftSavedAt).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </time>
                    </>
                  )}
                </p>
              )}
              {editing && editorMode !== "preview" ? (
                <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="gap-1 pr-1 text-xs">
                      {tag}
                      <button
                        type="button"
                        onClick={() => setTags((current) => current.filter((value) => value !== tag))}
                        className="rounded-full hover:bg-muted"
                        aria-label={`Remove tag ${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <Input
                    aria-label="Add tag"
                    placeholder="Add tag, press Enter"
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        commitTagDraft();
                      }
                    }}
                    onBlur={commitTagDraft}
                    className="h-7 w-36 border-none px-1 shadow-none focus-visible:ring-0"
                  />
                </div>
              ) : (editing ? tags : gist?.tags)?.length ? (
                <div className="ml-auto flex flex-wrap justify-end gap-1.5">
                  {(editing ? tags : gist?.tags ?? []).map((tag) => (
                    <Badge key={tag} variant="outline">{tag}</Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div
              className={cn(
                "min-h-[28rem] flex-1 text-sm transition-shadow",
                editing && "ring-2 ring-inset ring-amber-400/70 dark:ring-amber-700/60",
                editing && editorMode === "rich" && "tome-rich-editor-full-width",
              )}
              data-testid="gist-editor-canvas"
            >
              {editing && editorMode === "source" ? (
                <div className="h-full min-h-[28rem] p-3">
                  <RichCodeEditor
                    editorRef={sourceEditorRef}
                    value={rawDraft}
                    onChange={setRawDraft}
                    filename={filename}
                    language="markdown"
                    wrap
                    fillContainer
                    lintSource={diagnoseTomeMarkdown}
                    className="h-full"
                  />
                </div>
              ) : editing && editorMode === "preview" ? (
                <MarkdownRenderer
                  content={rawDraft}
                  variant="final"
                  className="tome-document-preview px-8 py-6"
                  enableExternalEmbeds
                  enableExcalidraw
                  enableMermaid
                  enableTomeColumns
                />
              ) : editing ? (
                <CrepeEditor
                  key={`${slug}-${id ?? "new"}-${editorEpoch}`}
                  ref={editorRef}
                  initialMarkdown={richInitialBody}
                  onChange={setRawDraft}
                  onInsertMedia={() => setMediaOpen(true)}
                  enableColumns
                />
              ) : gist ? (
                <MarkdownRenderer
                  content={gist.body}
                  variant="final"
                  className="tome-document-preview px-8 py-6"
                  enableExternalEmbeds
                  enableExcalidraw
                  enableMermaid
                  enableTomeColumns
                />
              ) : null}
            </div>
          </div>
        )}
      </ScrollArea>
      <TomeMediaInsertDialog
        open={mediaOpen}
        onOpenChange={setMediaOpen}
        onInsert={insertMediaMarkdown}
      />
    </div>
  );
}
