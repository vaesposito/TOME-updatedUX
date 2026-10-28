"use client";

import { ChevronRight, FileText, FolderKanban } from "lucide-react";

import type { PageTreeNode } from "@/types/tome";

/**
 * The landing view for a branch of the wiki tree: what it is, how much is in
 * it, and a row per thing inside.
 *
 * Every first-level rail row goes somewhere when clicked, so Wiki and
 * References need a destination rather than only a caret. A folder needs the
 * same page for the same reason, which is why one component serves all three
 * instead of each growing its own list.
 */
export function TreeIndex({
  icon,
  eyebrow,
  title,
  nodes,
  emptyNote,
  actions,
  onOpenPage,
  onOpenFolder,
}: {
  icon: React.ReactNode;
  /** What kind of thing this is — "Folder", "Wiki", "References". */
  eyebrow: string;
  title: string;
  nodes: readonly PageTreeNode[];
  /** Shown in place of the list when there is nothing in this branch yet. */
  emptyNote: string;
  /** Buttons for the header, e.g. New page. */
  actions?: React.ReactNode;
  onOpenPage: (path: string) => void;
  onOpenFolder: (folderId: string) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4 border-b pb-5">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {icon}
            {eyebrow}
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{countLabel(nodes.length)}</p>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {nodes.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">{emptyNote}</div>
      ) : (
        <div className="divide-y">
          {nodes.map((node) => (
            <button
              key={node.path}
              type="button"
              onClick={() => (node.kind === "folder" && node.folderId
                ? onOpenFolder(node.folderId)
                : onOpenPage(node.path))}
              className="flex w-full items-center gap-3 px-2 py-4 text-left transition-colors hover:bg-muted/60"
            >
              {node.kind === "folder" ? (
                <FolderKanban className="h-5 w-5 shrink-0 text-primary" />
              ) : (
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{node.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {node.kind === "folder" ? countLabel(node.children.length) : node.path}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}
