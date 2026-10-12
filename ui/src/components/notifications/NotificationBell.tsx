"use client";

import { Bell, CheckCheck, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";

import {
  AttentionMark,
} from "@/components/notifications/NotificationIcons";
import {
  notificationAccent,
  notificationByline,
  notificationOrigin,
  notificationType,
} from "@/components/notifications/notification-presentation";
import { UnreadDot } from "@/components/notifications/UnreadDot";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import {
  NOTIFICATION_GROUP_LABELS,
  type GroupedInAppNotificationPage,
  type InAppNotificationGroup,
  type InAppNotificationView,
  type NotificationGroupKey,
} from "@/types/in-app-notification";

const EMPTY_PAGE: GroupedInAppNotificationPage = {
  notifications: [],
  unread_count: 0,
  pagination: { page: 1, page_size: 10, total: 0, total_pages: 1 },
  groups: [],
};

/** Rows shown per section before the reader has to open the full inbox. */
const PER_GROUP = 6;

const COLLAPSED_GROUPS_KEY = "notification-bell:collapsed-groups";

function readCollapsedGroups(): NotificationGroupKey[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (key): key is NotificationGroupKey => key === "tome" || key === "platform",
    );
  } catch {
    // A collapsed section is a convenience, never worth failing the header for.
    return [];
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age ("now", "4m", "2h", "3d", "5w") for the right edge of a row. */
function relativeAge(isoDate: string): string {
  const elapsed = Date.now() - new Date(isoDate).getTime();
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / (7 * DAY))}w`;
}

function unwrapPage(value: unknown): GroupedInAppNotificationPage {
  const body = value as {
    data?: GroupedInAppNotificationPage;
  } & Partial<GroupedInAppNotificationPage>;
  const page = body.data ?? body;
  return {
    notifications: page.notifications ?? [],
    unread_count: page.unread_count ?? 0,
    pagination: page.pagination ?? EMPTY_PAGE.pagination,
    // An ungrouped response is still perfectly renderable — the dropdown just
    // falls back to one flat list rather than sections.
    groups: page.groups ?? [],
  };
}

/**
 * Mark one row read across both the flat list and the sections, which hold
 * the same notifications and must not drift apart.
 *
 * Group counts cover the whole group rather than just the rows on screen, so
 * they are decremented rather than recomputed from the visible rows.
 */
function withRowRead(
  page: GroupedInAppNotificationPage,
  id: string,
): GroupedInAppNotificationPage {
  const wasUnread = (rows: InAppNotificationView[]) =>
    rows.some((row) => row.id === id && !row.read);
  const flip = (row: InAppNotificationView) =>
    row.id === id ? { ...row, read: true } : row;

  return {
    ...page,
    notifications: page.notifications.map(flip),
    unread_count: Math.max(
      0,
      page.unread_count - (wasUnread(page.notifications) ? 1 : 0),
    ),
    groups: page.groups.map((group) => ({
      ...group,
      notifications: group.notifications.map(flip),
      unread_count: Math.max(
        0,
        group.unread_count - (wasUnread(group.notifications) ? 1 : 0),
      ),
    })),
  };
}

function withAllRead(
  page: GroupedInAppNotificationPage,
): GroupedInAppNotificationPage {
  const read = (row: InAppNotificationView) => ({ ...row, read: true });
  return {
    ...page,
    unread_count: 0,
    notifications: page.notifications.map(read),
    groups: page.groups.map((group) => ({
      ...group,
      unread_count: 0,
      notifications: group.notifications.map(read),
    })),
  };
}

function currentNotificationHref(href: string): string {
  const legacyPrefix = "/admin?";
  if (!href.startsWith(legacyPrefix)) return href;

  const params = new URLSearchParams(href.slice(legacyPrefix.length));
  if (params.get("cat") !== "security" || params.get("tab") !== "approvals") {
    return href;
  }
  params.delete("cat");
  params.delete("tab");
  const query = params.toString();
  return query ? `/admin/security/approvals?${query}` : "/admin/security/approvals";
}

function NotificationItem({
  notification,
  sectionLabel,
  onOpen,
}: {
  notification: InAppNotificationView;
  /** Section this row sits under, if any — used to avoid repeating it. */
  sectionLabel?: string;
  onOpen: (notification: InAppNotificationView) => void;
}) {
  const origin = notificationOrigin(notification);
  // Inside a section the header already names the source; repeating it on
  // every row is noise. Ungrouped, the tag is the only thing that says it.
  const showOrigin = origin.toLowerCase() !== sectionLabel?.toLowerCase();
  const byline = notificationByline(notification);

  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className={cn(
          "flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        {/* Beside the whole block, not beside the title, so the dot lines up
            with the inbox's and the rows keep one left margin. */}
        <UnreadDot unread={!notification.read} className="mt-[0.4375rem]" />

        <span className="min-w-0 flex-1">
          {/* Same order as a row in the full inbox: where it came from, what
              happened, which project, and when; then the headline; then what
              it says. A notification should not rearrange itself depending
              on which surface the reader happens to be looking at. */}
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-xs">
              {showOrigin ? (
                <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/70">
                  {origin}
                </span>
              ) : null}
              <span className={cn("font-medium", notificationAccent(notification))}>
                {notificationType(notification)}
              </span>
              {notification.entity_title ? (
                <span className="text-foreground/70">
                  {" · "}
                  {notification.entity_title}
                </span>
              ) : null}
            </span>
            <AttentionMark notification={notification} focusable={false} />
            <span
              className="shrink-0 text-[11px] text-foreground/70"
              title={new Date(notification.created_at).toLocaleString()}
            >
              {relativeAge(notification.created_at)}
            </span>
          </span>

          {/* Two lines rather than the inbox's one: the dropdown is less than
              half as wide, and a truncated headline there loses the point. */}
          <span
            className={cn(
              "mt-0.5 line-clamp-2 text-sm leading-snug",
              notification.read ? "font-medium" : "font-semibold",
            )}
          >
            {notification.title}
          </span>
          {byline ? (
            <span className="mt-0.5 block truncate text-xs text-foreground/80">
              {byline.text}
            </span>
          ) : null}
          {notification.lifecycle_status === "resolved" ? (
            <span className="mt-1 inline-block rounded-full border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
              Resolved
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function NotificationSection({
  group,
  collapsed,
  onToggle,
  onOpen,
}: {
  group: InAppNotificationGroup;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (notification: InAppNotificationView) => void;
}) {
  const label = NOTIFICATION_GROUP_LABELS[group.key];
  const hidden = group.total - group.notifications.length;

  return (
    <section>
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="sticky top-0 z-10 flex w-full items-center gap-2 border-b bg-muted/60 px-4 py-2 text-left backdrop-blur transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-foreground/70 transition-transform",
              !collapsed && "rotate-90",
            )}
            aria-hidden="true"
          />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
            {label}
          </span>
          {/* The count stays visible while collapsed, so folding a section
              away never hides the fact that it needs attention. */}
          {group.unread_count > 0 ? (
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold leading-4 text-foreground/70">
              {group.unread_count}
            </span>
          ) : null}
          <span className="ml-auto text-[10px] text-foreground/70">
            {collapsed ? `${group.total}` : hidden > 0 ? `+${hidden} more` : null}
          </span>
        </button>
      </h3>
      {collapsed ? null : (
        <ul role="list">
          {group.notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              sectionLabel={label}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function NotificationBell({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { hasUnsavedChanges, requestNavigation } = useUnsavedChangesStore();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<GroupedInAppNotificationPage>(EMPTY_PAGE);
  const [loading, setLoading] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<NotificationGroupKey[]>([]);

  // Read after mount so the server and first client render agree.
  React.useEffect(() => setCollapsed(readCollapsedGroups()), []);

  const toggleGroup = React.useCallback((key: NotificationGroupKey) => {
    setCollapsed((current) => {
      const next = current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key];
      try {
        window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // Private browsing and full quotas just mean it will not persist.
      }
      return next;
    });
  }, []);

  // The dropdown is a peek at the most recent notifications; paging and
  // filtering live on /notifications, which "See more" opens.
  const load = React.useCallback(async () => {
    if (!enabled) {
      setData(EMPTY_PAGE);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/notifications?grouped=1&per_group=${PER_GROUP}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`Notifications returned ${response.status}`);
      setData(unwrapPage(await response.json()));
    } catch {
      // Header notifications should never make the rest of the header noisy.
      // A later poll retries automatically.
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) {
      setData(EMPTY_PAGE);
      return;
    }
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    const refresh = () => void load();
    window.addEventListener("in-app-notifications:refresh", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("in-app-notifications:refresh", refresh);
    };
  }, [enabled, load]);

  const markRead = React.useCallback(async (id: string) => {
    setData((current) => withRowRead(current, id));
    await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  const openNotification = (notification: InAppNotificationView) => {
    void markRead(notification.id);
    setOpen(false);
    if (!notification.href) return;
    const href = currentNotificationHref(notification.href);
    if (hasUnsavedChanges) requestNavigation(href);
    else router.push(href);
  };

  const markAllRead = async () => {
    setData((current) => withAllRead(current));
    await fetch("/api/notifications/read-all", {
      method: "POST",
      keepalive: true,
    }).catch(() => undefined);
  };

  if (!enabled) return null;

  const unreadLabel = data.unread_count > 99 ? "99+" : String(data.unread_count);
  // Sections only earn their chrome when there is actually something to
  // separate. With one source in play the split says nothing, so the
  // dropdown stays a plain list.
  const populated = data.groups.filter((group) => group.total > 0);
  const sectioned = populated.length > 1;
  // Rows can arrive either way round depending on whether the response was
  // grouped, so emptiness is judged on both rather than on the flat list
  // alone — otherwise a grouped response reads as "no notifications".
  const flatRows =
    populated.length === 1 ? populated[0].notifications : data.notifications;
  const isEmpty = !sectioned && flatRows.length === 0;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          data-tour="notifications-bell"
          aria-label={data.unread_count > 0
            ? `${data.unread_count} unread notifications`
            : "Notifications"}
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          {data.unread_count > 0 && (
            <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-primary-foreground">
              {unreadLabel}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-[min(24rem,calc(100vw-1rem))] p-0"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-foreground/70">
              {data.unread_count > 0
                ? `${data.unread_count} unread`
                : "You’re all caught up ✅"}
            </p>
          </div>
          {data.unread_count > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void markAllRead()}>
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-[28rem] overflow-y-auto">
          {loading && isEmpty ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Loading notifications…
            </div>
          ) : isEmpty ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No notifications yet... but why not try to change that?
            </div>
          ) : sectioned ? (
            populated.map((group) => (
              <NotificationSection
                key={group.key}
                group={group}
                collapsed={collapsed.includes(group.key)}
                onToggle={() => toggleGroup(group.key)}
                onOpen={openNotification}
              />
            ))
          ) : (
            <ul role="list">
              {flatRows.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onOpen={openNotification}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-center border-t px-3 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            asChild
            onClick={() => setOpen(false)}
          >
            <Link href="/notifications">See more</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
