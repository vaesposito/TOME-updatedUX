"use client";

import { ChevronRight, RotateCcw, X } from "lucide-react";
import Link from "next/link";

import {
  ROW_ACTION_CLASS,
  artifactLink,
  notificationAccent,
  notificationByline,
  notificationOrigin,
  notificationTimestamp,
  notificationType,
} from "@/components/notifications/notification-presentation";
import {
  AttentionMark,
} from "@/components/notifications/NotificationIcons";
import { SelectionCheckbox } from "@/components/notifications/SelectionCheckbox";
import { UnreadDot } from "@/components/notifications/UnreadDot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InAppNotificationView } from "@/types/in-app-notification";

/**
 * One row of the notification inbox.
 *
 * Read top to bottom: where it came from, what happened, which project, and
 * when; then what it says; then what you can do about it. Rows needing
 * attention get a destructive border so a scan catches them without reading
 * any text.
 *
 * Secondary text is dimmed only slightly. Pushed further it reads as already
 * handled, which is the opposite of what an inbox is for.
 */
export function NotificationRow({
  notification,
  selected,
  onSelectedChange,
  onDismiss,
  onRestore,
  onOpen,
  busy,
}: {
  notification: InAppNotificationView;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onDismiss?: (id: string) => void;
  onRestore?: (id: string) => void;
  /** Following the link is what "I have seen this" means, so it clears the dot. */
  onOpen?: (id: string) => void;
  busy?: boolean;
}) {
  const accent = notificationAccent(notification);
  const urgent = notification.needs_attention || notification.severity === "error";
  const origin = notificationOrigin(notification);
  const type = notificationType(notification);
  const target = artifactLink(notification);
  const byline = notificationByline(notification);

  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 transition-colors",
        urgent
          ? "border-destructive/50 bg-destructive/5"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <SelectionCheckbox
        checked={selected}
        onCheckedChange={onSelectedChange}
        label={`Select "${notification.title}"`}
        className="mt-0.5"
      />

      {/* The dot sits beside the whole text block rather than beside the
          title, so every line of the row keeps one left margin and the eye
          can run straight down the list looking for dots. */}
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <UnreadDot unread={!notification.read} className="mt-[0.4375rem]" />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="min-w-0 flex-1 truncate text-xs">
              {/* Which product the row came from, said plainly: the list
                  mixes TOME with the rest of the platform and the wording
                  alone does not always give it away. */}
              <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/70">
                {origin}
              </span>
              <span className={cn("font-medium", accent)}>{type}</span>
              {notification.entity_title && (
                <span className="text-foreground/70">
                  {" · "}
                  {notification.entity_title}
                </span>
              )}
              {/* With the date gone to the right edge, the reference joins
                  the breadcrumb it belongs to: it names which release or
                  issue this concerns, not when it arrived. */}
              {notification.reference && (
                <span className="text-foreground/70">
                  {" · "}
                  {notification.reference}
                </span>
              )}
            </p>
            <AttentionMark notification={notification} />
          </div>

          <p
            className={cn(
              "mt-0.5 truncate text-sm",
              notification.read ? "font-medium" : "font-semibold",
            )}
          >
            {notification.title}
          </p>
          {byline && (
            <p className="mt-0.5 truncate text-xs text-foreground/80">
              {byline.text}
            </p>
          )}
        </div>
      </div>

      {/* Every action a row has, on one line, in the same order as the
          summary: dismissing and opening are the same pair of choices
          wherever a notification is shown, so they sit in the same place.
          Watching is absent on purpose — it is a standing choice about an
          entity, not a response to one notification, and it lives on the
          entity and in the Watching tab.

          A column beside the text rather than a line beneath it: stacked, the
          buttons cost every row a third of its height for two controls that
          are the same on all of them. `ml-auto` keeps them right-aligned
          once the row wraps on a narrow window. */}
      <div className="ml-auto flex shrink-0 items-center gap-2 self-center">
        {notification.dismissed
          ? onRestore && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={ROW_ACTION_CLASS}
                disabled={busy}
                onClick={() => onRestore(notification.id)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore
              </Button>
            )
          : onDismiss && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={ROW_ACTION_CLASS}
                disabled={busy}
                onClick={() => onDismiss(notification.id)}
              >
                <X className="h-3.5 w-3.5" />
                Dismiss
              </Button>
            )}

        {target && (
          <Button type="button" variant="outline" size="sm" className={ROW_ACTION_CLASS} asChild>
            <Link
              href={target.href}
              {...(target.external
                ? { target: "_blank", rel: "noreferrer noopener" }
                : {})}
              aria-label={target.aria}
              onClick={() => {
                if (!notification.read) onOpen?.(notification.id);
              }}
            >
              {target.label}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        )}

        {/* Last, against the row's own right edge, in a column of fixed
            width. Sat between the text and the buttons it moved with
            whatever buttons that row happened to have, so no two rows
            agreed on where "when" was. */}
        <span className="w-16 shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-foreground/70">
          {notificationTimestamp(notification.created_at)}
        </span>
      </div>
    </li>
  );
}
