"use client";

import { useState } from "react";
import { Check, ListFilter, X } from "lucide-react";

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
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);

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
            {removable && confirmingRemoval === tracked.id ? (
              <span
                role="group"
                aria-label={`Confirm removal of ${tracked.title} tracker`}
                className="mr-1 flex shrink-0 items-center gap-0.5 rounded bg-background/80 pl-1 text-[10px] text-muted-foreground"
              >
                <span className="px-0.5">Remove?</span>
                <button
                  type="button"
                  aria-label={`Confirm removal of ${tracked.title} tracker`}
                  title={`Remove ${tracked.title} tracker`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setConfirmingRemoval(null);
                    onRemove?.(tracked);
                  }}
                  className="rounded p-1 text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Cancel removal of ${tracked.title} tracker`}
                  title="Cancel"
                  onClick={(event) => {
                    event.stopPropagation();
                    setConfirmingRemoval(null);
                  }}
                  className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : removable ? (
              <button
                type="button"
                aria-label={`Remove ${tracked.title} tracker`}
                title={`Remove ${tracked.title} tracker`}
                onClick={(event) => {
                  event.stopPropagation();
                  setConfirmingRemoval(tracked.id);
                }}
                className="mr-1 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
