"use client";

import { ChevronRight } from "lucide-react";

import { BetaBadge } from "@/components/tome/BetaBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The rail's first-level rows.
 *
 * They share a file because they have to agree: a reader scanning the rail
 * reads them as one list, so a difference between them reads as a difference
 * in kind rather than a difference in implementation.
 */

/**
 * A rail row that is also the heading for a tree beneath it.
 *
 * The caret is a control of its own, beside the row rather than part of it,
 * so that every first-level row behaves the same way: clicking it goes
 * somewhere, and only the caret opens or closes what is underneath. Wiki and
 * Referencing Projects each have a landing view listing what they hold, so "go
 * somewhere" means something for them too.
 *
 * The caret sits at the trailing edge, out of the way of the icons and labels
 * that are read down the rail, and far enough from the row's text that
 * reaching for one is not a near miss for the other. `NavItem` keeps an empty
 * column the same width, so the rows end together.
 */
export function NavSection({
  icon,
  label,
  active,
  expanded,
  onToggle,
  onClick,
  controlsId,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  /** Whether what is open belongs to this section. */
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Where the row goes — its own landing view, listing what it holds. */
  onClick: () => void;
  controlsId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "flex w-full items-center rounded-md pr-2 text-sm font-medium transition-colors hover:bg-muted",
          active && "bg-muted text-primary",
        )}
      >
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 text-left"
        >
          {icon}
          <span className="flex-1 truncate">{label}</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={controlsId}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          className="shrink-0 rounded-md py-2 pl-1"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
      </div>
      {expanded && (
        <div id={controlsId} className="mt-1">
          {children}
        </div>
      )}
    </div>
  );
}

export function NavItem({
  icon,
  label,
  active,
  onClick,
  tipTitle,
  tipDescription,
  tag,
  beta,
  reserveCaret,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  tipTitle?: string;
  tipDescription?: React.ReactNode;
  /** Small trailing badge, e.g. "needs review". */
  tag?: string;
  /**
   * Hold open the trailing column a `NavSection` puts its caret in, so the
   * rows end together. The caret itself stays absent: it would promise
   * something to open, and there is nothing under this row.
   */
  reserveCaret?: boolean;
  /** Renders a presentational Beta badge; the row tooltip owns the explanation. */
  beta?: boolean;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors hover:bg-muted",
        active && "bg-muted text-primary",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {beta && <BetaBadge showTooltip={false} />}
      {tag && (
        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          {tag}
        </span>
      )}
      {reserveCaret && <span aria-hidden className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );

  if (!tipTitle) return button;

  return (
    <Tooltip className="w-full">
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        className="flex w-64 flex-col gap-1 whitespace-normal text-[11px] font-normal normal-case leading-relaxed"
      >
        <span className="text-xs font-semibold">{tipTitle}</span>
        <span className="opacity-70">{tipDescription}</span>
      </TooltipContent>
    </Tooltip>
  );
}
