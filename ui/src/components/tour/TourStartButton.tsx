"use client";

import { Compass } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TOURS, NOTIFICATIONS_TOUR_ID } from "@/components/tour/tour-catalog";
import { prefetchTourSubject } from "@/components/tour/TourRunner";
import { startTour } from "@/components/tour/tour";
import { cn } from "@/lib/utils";

/**
 * Starts a walkthrough.
 *
 * A window event rather than a shared context: the runner is mounted in the
 * app shell, far above anything that would sensibly offer to start one, and
 * one event spares every page in between a provider it has no other use
 * for. The same convention the notification bell already uses to ask for a
 * refresh.
 */
export function TourStartButton({
  label = "Take the tour",
  tourId = NOTIFICATIONS_TOUR_ID,
  className,
  icon,
  onStart,
}: {
  label?: string;
  /** Which tour to start. */
  tourId?: string;
  className?: string;
  icon?: React.ReactNode;
  /** Run before the tour starts, for a host that has to prepare the page. */
  onStart?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-8 gap-1.5 px-2 text-xs text-muted-foreground", className)}
      onClick={() => {
        onStart?.();
        startTour(tourId);
      }}
    >
      {icon ?? <Compass className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </Button>
  );
}

/**
 * Offers the walkthroughs and starts the chosen one.
 *
 * Asking which tour before starting one, rather than running a single tour
 * of everything: most people arrive wanting one thing, and twenty steps to
 * reach it is a toll rather than a tour. Each entry says what it covers, so
 * the choice can be made without taking all five.
 */
export function TourMenu({
  label = "Take a tour",
  className,
  onStart,
}: {
  label?: string;
  className?: string;
  /**
   * Run before the chosen tour starts.
   *
   * For a host that has to put itself into the state a first step describes
   * — the catalogue's tours open on the project tab, and the reader may be
   * looking at another one.
   */
  onStart?: () => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reading five names takes about as long as finding the project the
        // project-bound steps borrow, so the two happen together and the
        // chosen tour opens on the page it is about rather than on a wait.
        if (next) prefetchTourSubject();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 gap-1.5 px-2 text-xs text-muted-foreground",
            className,
          )}
        >
          <Compass className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Choose a walkthrough
        </p>
        <ul>
          {TOURS.map((tour) => (
            <li key={tour.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onStart?.();
                  startTour(tour.id);
                }}
                className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {tour.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {tour.steps.length} steps
                  </span>
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {tour.blurb}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
