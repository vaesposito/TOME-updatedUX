"use client";

/**
 * The wiki tree as something to tidy rather than somewhere to go.
 *
 * The rail's copy of this tree answers "where do I read next"; this one
 * answers "what do I want less of". Same component underneath — the tree is
 * handed in already rendered — with a bar that appears only once something is
 * ticked, so the panel is quiet until there is a reason for it not to be.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PageTreeNode } from "@/types/tome";
import { Loader2, Search, Trash2 } from "lucide-react";

export function WikiContentManager({
  toolbar,
  tree,
  query,
  onQueryChange,
  checked,
  busy,
  folders,
  onClear,
  onMove,
  onDelete,
}: {
  /** New folder, import, new page. */
  toolbar: React.ReactNode;
  /** The tree, rendered by its owner so there is only ever one of it. */
  tree: React.ReactNode;
  query: string;
  onQueryChange: (next: string) => void;
  checked: readonly PageTreeNode[];
  busy: boolean;
  folders: readonly { id: string; name: string }[];
  onClear: () => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const count = checked.length;
  // Folders among the selection cannot also be destinations for it.
  const selectedFolderIds = new Set(
    checked.filter((node) => node.kind === "folder").map((node) => node.folderId),
  );
  const destinations = folders.filter((folder) => !selectedFolderIds.has(folder.id));

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          Tick anything here to move or remove several at once. What a page says,
          and whether it is stable or dynamic, are settled on the page itself.
        </p>
        <div className="flex shrink-0 items-center gap-1">{toolbar}</div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search pages and folders"
          aria-label="Search pages and folders"
          className="h-8 pl-7 text-xs"
        />
      </div>

      {/*
        Only once something is ticked. A bar that is always there, greyed out,
        is a row of controls that spends most of its life explaining that it
        does nothing.
      */}
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
          <span className="text-xs font-medium">
            {count} selected
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Popover open={moving} onOpenChange={setMoving}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  Move to
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-72 w-56 overflow-y-auto p-1">
                <button
                  type="button"
                  onClick={() => {
                    onMove(null);
                    setMoving(false);
                  }}
                  className="w-full rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  Top level
                </button>
                {destinations.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => {
                      onMove(folder.id);
                      setMoving(false);
                    }}
                    className="w-full truncate rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    {folder.name}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Delete
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border p-2">{tree}</div>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {count} {count === 1 ? "item" : "items"}?
            </DialogTitle>
            <DialogDescription>
              {/* Named rather than counted: a reader about to lose five things
                  should be shown which five. */}
              This removes {checked.map((node) => node.title).join(", ")}
              {checked.some((node) => node.kind === "folder")
                ? ", and everything inside the folders among them."
                : "."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                onDelete();
                setConfirming(false);
              }}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
