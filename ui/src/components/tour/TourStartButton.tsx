"use client";

import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TOUR_START_EVENT } from "@/components/tour/notification-tour";
import { cn } from "@/lib/utils";

/**
 * Starts a walkthrough.
 *
 * A window event rather than a shared context: the tour is mounted in the
 * app shell, far above anything that would sensibly offer to start it, and
 * one event spares every page in between a provider it has no other use for.
 * The same convention the notification bell already uses to ask for a
 * refresh.
 */
export function TourStartButton({
  label = "Take the tour",
  event = TOUR_START_EVENT,
  className,
  icon,
  onStart,
}: {
  label?: string;
  /** Which tour to start. Defaults to the notifications one. */
  event?: string;
  className?: string;
  icon?: React.ReactNode;
  /**
   * Run before the tour starts.
   *
   * For a host that has to put itself into the state the first step
   * describes — the catalogue's own tour opens on the project tab, and the
   * reader may be looking at another one.
   */
  onStart?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-8 gap-1.5 px-2 text-xs text-muted-foreground", className)}
      onClick={() => {
        onStart?.();
        window.dispatchEvent(new Event(event));
      }}
    >
      {icon ?? <Compass className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </Button>
  );
}
