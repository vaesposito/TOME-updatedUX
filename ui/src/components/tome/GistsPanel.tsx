"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Link2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/tome/PanelHeader";
import { TomeLoading } from "@/components/tome/TomeLoading";
import { cn } from "@/lib/utils";
import type { GistRecord } from "@/types/tome";

/**
 * Gists: quick, non-committal chunks of context (a prompt, an agent memory, a
 * snippet) saved without becoming part of the curated wiki, not ingested, not
 * synthesized, not loaded into agent context by default. Every gist is posted
 * to the Feed automatically at creation (also reachable via the
 * tome_list_gists/tome_get_gist MCP tools). Tags are freeform labels for
 * lightweight filtering, no folder hierarchy.
 */

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export function GistsPanel({
  slug,
  canEdit,
  onOpenGist,
  onNewGist,
}: {
  slug: string;
  canEdit: boolean;
  onOpenGist: (id: string) => void;
  onNewGist: (title: string) => void;
}) {
  const [gists, setGists] = useState<GistRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [newGistOpen, setNewGistOpen] = useState(false);
  const [newGistName, setNewGistName] = useState("");
  const newGistInputRef = useRef<HTMLInputElement | null>(null);

  const existingDraftTitle = useCallback((): string => {
    try {
      const stored = window.localStorage.getItem(`tome:gist-draft:${slug}:new`);
      if (!stored) return "";
      const parsed = JSON.parse(stored) as { title?: unknown };
      return typeof parsed.title === "string" ? parsed.title : "";
    } catch {
      return "";
    }
  }, [slug]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tome/projects/${slug}/gists`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || `Failed to load gists (${res.status})`);
      setGists(body?.data?.gists ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGists([]);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (gist: GistRecord) => {
      if (!window.confirm(`Delete gist "${gist.title}"?`)) return;
      try {
        const res = await fetch(`/api/tome/projects/${slug}/gists/${gist.id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message || `Delete failed (${res.status})`);
        }
        setGists((prev) => (prev ?? []).filter((g) => g.id !== gist.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [slug],
  );

  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const g of gists ?? []) for (const t of g.tags ?? []) seen.add(t);
    return [...seen].sort();
  }, [gists]);

  const visible = useMemo(() => {
    if (!activeTag) return gists ?? [];
    return (gists ?? []).filter((g) => g.tags?.includes(activeTag));
  }, [gists, activeTag]);

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-4xl px-6 pt-6">
        <PanelHeader
          title="Gists"
          description="Quick, non-committal context saved outside the wiki."
          action={(
            <Dialog
              open={newGistOpen}
              onOpenChange={(open) => {
                setNewGistOpen(open);
                if (open) {
                  setNewGistName(existingDraftTitle());
                  setTimeout(() => newGistInputRef.current?.focus(), 0);
                } else {
                  setNewGistName("");
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  New gist
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>New gist</DialogTitle>
                  <DialogDescription>
                    Enter a gist name, then draft it in the editor.
                  </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = newGistName.trim();
                    if (!name) return;
                    onNewGist(name);
                    setNewGistOpen(false);
                    setNewGistName("");
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <label
                      htmlFor="tome-new-gist-input"
                      className="block text-sm font-medium text-foreground"
                    >
                      Gist name
                    </label>
                    <Input
                      id="tome-new-gist-input"
                      ref={newGistInputRef}
                      value={newGistName}
                      onChange={(event) => setNewGistName(event.target.value)}
                      placeholder="Deployment notes"
                      aria-label="New gist name"
                    />
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button type="submit" size="sm" disabled={!newGistName.trim()}>
                      Write in editor
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
        />
      </div>

      {error && (
        <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="flex-1 overflow-auto">
        {gists === null ? (
          <TomeLoading variant="list" />
        ) : gists.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-base font-semibold">No gists yet</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Save a working prompt, a deploy note, or an agent memory here, it stays out of the
              wiki until someone chooses to pull it in.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl px-6 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              {allTags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveTag(null)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                      !activeTag
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    All
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setActiveTag(tag === activeTag ? null : tag)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                        tag === activeTag
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : (
                <div />
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {visible.map((gist) => (
                <li
                  key={gist.id}
                  className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/projects/${slug}/tome/gists/${gist.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onOpenGist(gist.id);
                      }}
                      className="font-medium text-foreground hover:underline"
                    >
                      {gist.title}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {gist.author} · {timeLabel(gist.created_at)}
                    </div>
                    {gist.tags && gist.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {gist.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <CopyButton
                      value={() => `${window.location.origin}/projects/${slug}/tome/gists/${gist.id}`}
                      label="Copy link to this gist"
                      copiedLabel="Link copied"
                      icon={Link2}
                      className="h-7 w-7 text-muted-foreground/60"
                    />
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground/60 hover:text-destructive"
                        aria-label="Delete gist"
                        onClick={() => void remove(gist)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
