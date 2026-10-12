"use client";

import { CircleAlert } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { InAppNotificationView } from "@/types/in-app-notification";

/**
 * The "!" mark for rows that are either flagged as needing attention or
 * addressed to this reader by name.
 *
 * Both are reasons to stop scanning and read, which is why they share one
 * glyph; the tooltip says which applies, since the distinction matters once
 * you have stopped. Rows that are merely unread keep the dot and nothing
 * more — a mark on everything would mark nothing.
 */
export function AttentionMark({
  notification,
  className,
  /**
   * False when the row itself is a button: a tabbable child inside one is
   * nested interactive content, and the reason is already on the row's
   * accessible name.
   */
  focusable = true,
}: {
  notification: Pick<InAppNotificationView, "needs_attention" | "mentioned">;
  className?: string;
  focusable?: boolean;
}) {
  const { needs_attention: important, mentioned } = notification;
  if (!important && !mentioned) return null;

  const reason = important
    ? mentioned
      ? "Needs attention · you were mentioned"
      : "Needs attention"
    : "You were mentioned";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Focusable where it can be, so the reason is reachable by keyboard
            and not only by hovering. The browser's own `title` is gone: it
            would open a second, unstyled bubble alongside this one. */}
        <span
          role="img"
          aria-label={reason}
          tabIndex={focusable ? 0 : undefined}
          className="flex shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleAlert
            className={cn(
              "h-3.5 w-3.5",
              // The glyph is the signal for a mention; only importance earns
              // colour on top of it.
              important ? "text-destructive" : "text-muted-foreground",
              className,
            )}
            aria-hidden="true"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{reason}</TooltipContent>
    </Tooltip>
  );
}
