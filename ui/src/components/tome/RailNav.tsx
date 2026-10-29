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
 * Clicking the row does both things: it goes to the section's landing view
 * and it opens or closes what is underneath. A row with a tree under it
 * reads as the way into that tree, and asking for the caret specifically is
 * a small target to hit for the thing the whole row looks like it does.
 *
 * The caret stays, as the way to open a section without leaving where you
 * are. It sits at the trailing edge, out of the way of the icons and labels
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
  count,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  /** Whether what is open belongs to this section. */
  active: boolean;
  expanded: boolean;
  /**
   * How much is under this section.
   *
   * Said on the row rather than left to be found: opening a section to learn
   * how much is in it, or that there is nothing in it, costs a click for
   * something the rail could have shown. Left undefined while the tree is
   * still arriving — a nought there would be a count, and wrong.
   *
   * At nought the row still goes somewhere, because its landing view is where
   * an empty section explains itself and offers the way to fill it.
   */
  count?: number;
  onToggle: () => void;
  /** Where the row goes — its own landing view, listing what it holds. */
  onClick: () => void;
  controlsId: string;
  children: React.ReactNode;
}) {
  const empty = count === 0;

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
          // Not when there is nothing under it: there is no caret on an empty
          // section either, and a row that reports itself empty should not
          // also claim to open.
          onClick={() => {
            onClick();
            if (!empty) onToggle();
          }}
          aria-expanded={empty ? undefined : expanded}
          aria-controls={empty ? undefined : controlsId}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 text-left"
        >
          {icon}
          <span className="flex-1 truncate">{label}</span>
        </button>
        <NavCount count={count} />
        {empty ? (
          <span aria-hidden className="h-3.5 w-3.5 shrink-0" />
        ) : (
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
        )}
      </div>
      {/* Ranged under the label, not under the icon: the icon is the mark for
          the section as a whole, so a row beginning beneath it reads as a
          sibling of the section rather than something kept inside it. Twenty-
          four clears the icon and the gap after it, which is exactly where the
          label starts. */}
      {expanded && !empty && (
        <div id={controlsId} className="mt-1 pl-6">
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

/**
 * How much is under a row.
 *
 * One mark for both answers rather than a word for nothing and a number for
 * something: a reader going down the rail is comparing these, and "Empty"
 * beside "3" is two different things to read where a nought beside a three
 * is one. Lining figures, so the column reads straight.
 *
 * Nothing at all while the count is unknown, which is not the same as nought.
 */
export function NavCount({ count, className }: { count?: number; className?: string }) {
  if (count === undefined) return null;
  return (
    <span
      className={cn(
        "shrink-0 pl-2 text-[10px] font-normal tabular-nums text-muted-foreground/70",
        className,
      )}
    >
      {count}
    </span>
  );
}
