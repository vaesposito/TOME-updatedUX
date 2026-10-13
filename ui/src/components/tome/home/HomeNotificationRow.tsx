"use client";

import Link from "next/link";
import * as React from "react";

import { AttentionMark } from "@/components/notifications/NotificationIcons";
import {
  artifactLink,
  notificationByline,
  notificationOrigin,
  notificationTimestamp,
  notificationType,
} from "@/components/notifications/notification-presentation";
import { UnreadDot } from "@/components/notifications/UnreadDot";
import { cn } from "@/lib/utils";
import type { TomeSummaryItem } from "@/types/tome-summary";

/**
 * A notification as a home-page card shows it.
 *
 * The same facts in the same order as the inbox — where it came from and what
 * happened, the headline, who did it, when — but the whole row is one link
 * and the Dismiss and Open buttons are gone. A card three columns wide has no
 * room for them, and a home page is read to find out what to look at next;
 * working through the list is what the inbox is for.
 */
export function HomeNotificationRow({
  item,
  viewing,
  onOpen,
}: {
  item: TomeSummaryItem;
  /** Entity whose home page this is, so a row about it links to the artifact. */
  viewing: string;
  onOpen?: (item: TomeSummaryItem) => void;
}) {
  const target = artifactLink(item, viewing);
  const mentioned = item.reason === "mentioned";
  const byline = notificationByline({ ...item, mentioned });
  const type = notificationType({ ...item, mentioned });

  const body = (
    <>
      <UnreadDot unread={!item.read && !item.resolved} className="mt-[0.375rem]" />

      <span className="min-w-0 flex-1">
        <span className="block min-w-0 truncate text-[11px] text-muted-foreground">
          {notificationOrigin(item)}
          {" · "}
          {type}
          {/* Named only when it is not the space being read. A BHAG's or an
              Area's cards gather rows from everything beneath them, and
              "posted October status" says nothing without knowing where;
              on a project's own page every row is the same entity and
              repeating it on each one is noise. */}
          {item.entity_slug !== viewing && item.entity_title
            ? ` · ${item.entity_title}`
            : ""}
          {item.reference ? ` · ${item.reference}` : ""}
        </span>
        <span
          className={cn(
            "mt-0.5 block truncate text-xs",
            item.read ? "font-medium" : "font-semibold",
          )}
        >
          {item.title}
        </span>
        {byline && (
          <span className="mt-0.5 block truncate text-[11px] text-foreground/70">
            {byline.text}
          </span>
        )}
      </span>

      {/* Against the row's right edge with the mark outside it, as in the
          inbox, so "when" and "look at this" are found in the same place on
          every surface that shows a notification. */}
      <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-foreground/60">
        {item.resolved ? "Resolved" : notificationTimestamp(item.created_at)}
      </span>
      <span className="flex w-3.5 shrink-0 justify-end">
        <AttentionMark
          notification={{ ...item, mentioned }}
          focusable={!target}
        />
      </span>
    </>
  );

  const shell = "flex items-start gap-2 rounded-md px-2 py-1.5 -mx-2";
  if (!target) {
    return <li className={shell}>{body}</li>;
  }
  return (
    <li>
      <Link
        href={target.href}
        {...(target.external
          ? { target: "_blank", rel: "noreferrer noopener" }
          : {})}
        aria-label={target.aria}
        onClick={() => {
          if (!item.read) onOpen?.(item);
        }}
        className={cn(shell, "transition-colors hover:bg-muted/60")}
      >
        {body}
      </Link>
    </li>
  );
}

/** A card's worth of notifications, or the reason there are none. */
export function HomeNotificationList({
  items,
  viewing,
  limit,
  onOpen,
  empty,
}: {
  items: readonly TomeSummaryItem[];
  viewing: string;
  limit: number;
  onOpen?: (item: TomeSummaryItem) => void;
  empty: React.ReactNode;
}) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.slice(0, limit).map((item) => (
        <HomeNotificationRow
          key={item.id}
          item={item}
          viewing={viewing}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}
