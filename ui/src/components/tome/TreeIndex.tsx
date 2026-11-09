"use client";

import { ChevronRight, FileText, FolderKanban } from "lucide-react";

import { PanelShell } from "@/components/tome/PanelHeader";
import { TomeEmpty, type TomeEmptyAction } from "@/components/tome/TomeEmpty";
import type { PageTreeNode } from "@/types/tome";

/**
 * The landing view for a branch of the wiki tree: what it is, how much is in
 * it, and a row per thing inside.
 *
 * Every first-level rail row goes somewhere when clicked, so Wiki and
 * Referencing Projects need a destination rather than only a caret. A folder
 * needs the same page for the same reason, which is why one component serves
 * all three instead of each growing its own list.
 *
 * It heads itself through PanelShell, like every other place the rail leads
 * to, so arriving here from Notes or Issues is the same arrival.
 */
export function TreeIndex({
  icon,
  title,
  description,
  nodes,
  emptyNote,
  emptyAction,
  actions,
  lead,
  leadCount = 0,
  onOpenPage,
  onOpenFolder,
}: {
  /** Stands in for the branch in the empty state; the heading carries no icon. */
  icon: React.ReactNode;
  title: string;
  /** What this branch holds, in one sentence. */
  description: React.ReactNode;
  nodes: readonly PageTreeNode[];
  /** What would put something in this branch, in one sentence. */
  emptyNote: string;
  /** The one thing to go and do about an empty branch. */
  emptyAction?: TomeEmptyAction;
  /** Buttons for the header, e.g. New page. */
  actions?: React.ReactNode;
  /**
   * Something this branch holds that is not a page, drawn above the tree.
   *
   * Connections holds both the spaces tagged alongside this one and the
   * sources it mirrors. They are unlike enough to need their own heading and
   * alike enough to belong on one page.
   */
  lead?: React.ReactNode;
  /** How much `lead` holds, so the heading counts everything on the page. */
  leadCount?: number;
  onOpenPage: (path: string) => void;
  onOpenFolder: (folderId: string) => void;
}) {
  return (
    <PanelShell
      title={title}
      description={description}
      titleAccessory={
        <span className="text-xs font-normal text-muted-foreground">
          {countLabel(nodes.length + leadCount)}
        </span>
      }
      action={actions && <div className="flex items-center gap-2">{actions}</div>}
    >
      {lead}

      {nodes.length === 0 ? (
        // The full empty state only when the page would otherwise be blank:
        // a branch already showing something has been arrived at, and an
        // illustration under it would read as the page having failed.
        leadCount > 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">{emptyNote}</p>
        ) : (
          <TomeEmpty
            icon={icon}
            headline={`Nothing in ${title} yet`}
            hint={emptyNote}
            action={emptyAction}
          />
        )
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
    </PanelShell>
  );
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}
