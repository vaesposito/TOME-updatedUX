"use client";

/**
 * The tracked labels, as a filter over the issues rather than places to go.
 *
 * The same labels used to be rows in the left rail, which made each one look
 * like a section of the project with its own contents. They are not: they are
 * one list of issues, narrowed. Putting them above that list says so, and
 * puts the choice next to the thing it changes.
 *
 * Exactly one is always on, because the issues are read one label at a time.
 */

import { Check, X } from "lucide-react";
import * as React from "react";

import type { TomeTrackedIssueLabel } from "@/lib/tome/issue-filter-views";
import { cn } from "@/lib/utils";

export function IssueLabelFilter({
  labels,
  activeLabel,
  onSelect,
  onRemove,
  isRemovable,
  action,
}: {
  labels: readonly TomeTrackedIssueLabel[];
  activeLabel?: string;
  onSelect: (label: string) => void;
  onRemove?: (tracked: TomeTrackedIssueLabel) => void;
  isRemovable?: (tracked: TomeTrackedIssueLabel) => boolean;
  /** Whatever adds a label, kept at the end of the row it adds to. */
  action?: React.ReactNode;
}) {
  const [confirming, setConfirming] = React.useState<string | null>(null);

  if (labels.length === 0) return action ? <>{action}</> : null;

  return (
    <div
      role="group"
      aria-label="Filter issues by tracked label"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      {labels.map((tracked) => {
        const active = activeLabel?.toLowerCase() === tracked.label;
        const removable = Boolean(onRemove && (isRemovable?.(tracked) ?? true));

        if (removable && confirming === tracked.id) {
          return (
            <span
              key={tracked.id}
              role="group"
              aria-label={`Confirm removal of ${tracked.title} tracker`}
              className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background py-0.5 pl-2.5 pr-1 text-xs text-muted-foreground"
            >
              Remove {tracked.title}?
              <button
                type="button"
                aria-label={`Confirm removal of ${tracked.title} tracker`}
                onClick={() => {
                  setConfirming(null);
                  onRemove?.(tracked);
                }}
                className="rounded-full p-1 text-destructive hover:bg-destructive/10"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={`Cancel removal of ${tracked.title} tracker`}
                onClick={() => setConfirming(null)}
                className="rounded-full p-1 hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        }

        return (
          <span
            key={tracked.id}
            className={cn(
              "group inline-flex items-center rounded-full border text-xs transition-colors",
              active
                ? "border-primary/40 bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <button
              type="button"
              data-issue-label-filter={tracked.label}
              aria-pressed={active}
              onClick={() => onSelect(tracked.label)}
              className={cn("py-1 pl-3", removable ? "pr-1" : "pr-3")}
            >
              {tracked.title}
            </button>
            {removable && (
              <button
                type="button"
                aria-label={`Remove ${tracked.title} tracker`}
                title={`Remove ${tracked.title} tracker`}
                onClick={() => setConfirming(tracked.id)}
                className="mr-1 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}
      {action}
    </div>
  );
}
