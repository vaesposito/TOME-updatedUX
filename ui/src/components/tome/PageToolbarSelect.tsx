"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one look every picker in the page editor's toolbar wears.
 *
 * Connecting a space, choosing the page's kind and choosing who hears about
 * the save are the same kind of act — opening a short list and picking from
 * it — so they are the same kind of control: a bordered field with a chevron,
 * scaled down from the shared `SearchablePicker` trigger the rest of the app
 * uses. Before this they were a dashed chip, a filled colour-coded pill and a
 * bordered dropdown, which left nothing in the row saying what was pressable.
 *
 * Held as one component rather than a shared class string because three files
 * draw these triggers, and a string is a thing two of them drift away from.
 *
 * Only the trigger: each picker keeps its own popover, since what is inside
 * them is a search field, a set of checkboxes and a list of kinds, which have
 * nothing to share.
 */
export const PageToolbarSelect = React.forwardRef<
  HTMLButtonElement,
  {
    /** Stands in for what is being chosen. Tinted only to carry meaning the
     *  label cannot, as the page kind's does. */
    icon: React.ReactNode;
    /** Whether the popover is open, so the chevron can say so. */
    open?: boolean;
    /**
     * Whether this control is carrying a choice someone made.
     *
     * Said in the text's weight of colour rather than a fill, so a row of
     * these reads as one family with one of them answered.
     */
    active?: boolean;
    children: React.ReactNode;
  } & Omit<React.ComponentPropsWithoutRef<"button">, "children">
>(function PageToolbarSelect(
  { icon, open = false, active = false, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium transition-colors",
        "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        active ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
      <ChevronDown
        className={cn(
          "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-180",
        )}
        aria-hidden="true"
      />
    </button>
  );
});
