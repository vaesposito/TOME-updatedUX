"use client";

import { HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TOUR_START_EVENT } from "@/components/tour/notification-tour";

/**
 * Starts the notifications walkthrough.
 *
 * A window event rather than a shared context: the tour is mounted in the
 * app shell, far above anything that would sensibly offer to start it, and
 * one event spares every page in between a provider it has no other use for.
 * The same convention the notification bell already uses to ask for a
 * refresh.
 */
export function TourStartButton({ label = "Take the tour" }: { label?: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
      onClick={() => window.dispatchEvent(new Event(TOUR_START_EVENT))}
    >
      <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Button>
  );
}
