"use client";

import { ListFilter, X } from "lucide-react";

import type { TomeTrackedIssueLabel } from "@/lib/tome/issue-filter-views";
import { cn } from "@/lib/utils";

interface IssueLabelViewListProps {
  labels: readonly TomeTrackedIssueLabel[];
  activeLabel?: string;
  onSelect: (label: string) => void;
  onRemove?: (tracked: TomeTrackedIssueLabel) => void;
  isRemovable?: (tracked: TomeTrackedIssueLabel) => boolean;
}

export function IssueLabelViewList({
  labels,
  activeLabel,
  onSelect,
  onRemove,
  isRemovable,
}: IssueLabelViewListProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {labels.map((tracked) => {
        const active = activeLabel?.toLowerCase() === tracked.label;
        const removable = Boolean(onRemove && (isRemovable?.(tracked) ?? true));
        return (
          <div
            key={tracked.id}
            className={cn(
              "group ml-5 flex min-w-0 items-center rounded-md text-xs transition-colors hover:bg-muted",
              active && "bg-muted font-medium text-primary",
            )}
          >
            <button
              type="button"
              data-issue-label-view={tracked.label}
              aria-label={tracked.title}
              onClick={() => onSelect(tracked.label)}
              className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
            >
              <ListFilter className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate">{tracked.title}</span>
                <code className="block truncate font-mono text-[10px] font-normal text-muted-foreground">
                  {tracked.label}
                </code>
              </span>
            </button>
            {removable && (
              <button
                type="button"
                aria-label={`Remove ${tracked.title} tracker`}
                title={`Remove ${tracked.title} tracker`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove?.(tracked);
                }}
                className="mr-1 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
