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
  holdsNothing,
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
  /**
   * Nothing beneath, whatever the count says.
   *
   * A row can hold things that themselves hold nothing — five connected
   * sources with nothing read from any of them. Its figure is honest and
   * stays, but the row still leads nowhere today, so it is lightened as if
   * it were empty. It keeps its caret: there is something to open.
   */
  holdsNothing?: boolean;
}) {
  const empty = count === 0;

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "flex w-full items-center rounded-md pr-2 text-sm font-medium transition-colors hover:bg-muted",
          // Lighter while it holds nothing, on the same terms as the rows
          // under it. A connected source with nothing read from it yet is
          // still a row that leads nowhere today, and should look like one.
          (empty || holdsNothing) && "text-muted-foreground/60",
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
            // No padding of its own against the count: the count brings its
            // own, and a second gap here put this row's figure four pixels
            // off every other row's.
            className="shrink-0 rounded-md py-2"
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
        <div id={controlsId} className="relative mt-1 pl-6">
          {/* A line down from the middle of the section's own icon, so what
              hangs under the label is also visibly tied to the row it came
              from. Drawn rather than bordered: a border would eat into the
              padding and take every label a pixel off the row above. */}
          {/* Not bg-border: against the rail's own light panel that is a
              shade off invisible, and a guide nobody can see guides nobody.
              Taken from the text colour instead, so it holds in both themes. */}
          <span aria-hidden className="absolute inset-y-0 left-4 w-px bg-foreground/20" />
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
  count,
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
   * How much this row leads to, counted the same way a section's is.
   *
   * A row with contents says how many, including nought, so the rail can be
   * read down a single column rather than opened place by place. Left
   * undefined by rows that hold one thing or no things — a count of a
   * settings page is a number about nothing.
   */
  count?: number;
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
        // Lighter while it leads nowhere, so the rail can be read down its
        // column for what is worth opening. The nought stays beside it: the
        // colour is the glance, the figure is the answer.
        count === 0 && "text-muted-foreground/60",
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
      {/* Gapless, unlike the row that holds it: the row's own gap after the
          count would stand this figure further from the edge than a
          section's, and the two sit one above the other. */}
      <span className="flex shrink-0 items-center">
        <NavCount count={count} />
        {reserveCaret && <span aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      </span>
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
