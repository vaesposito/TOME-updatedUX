import {
  NOTIFICATION_TYPE_FACETS,
  TOME_NOTIFICATION_CATEGORIES,
  isStillNew,
  notificationAction,
  type InAppNotificationCategory,
  type InAppNotificationLifecycleStatus,
  type InAppNotificationView,
  type NotificationAction,
} from "@/types/in-app-notification";

/**
 * Sizing shared by every action on a notification row, matching the controls
 * in the page header above them.
 *
 * Real outlined buttons rather than bare text: as plain words tucked under
 * the message they read as the end of the sentence rather than as things to
 * press. Kept here so the inbox and the summary cannot drift apart.
 */
export const ROW_ACTION_CLASS = "h-auto gap-1.5 px-2 py-1 text-xs";

/**
 * The line under a row's headline: who did it, or what they said.
 *
 * Senders used to write this line themselves and it came out as whatever
 * they felt like counting — "3 projects reported · 2 decisions settled · 1
 * slip" — which is a different fact on every row and so tells a scanning
 * reader nothing. The one thing worth saying in the same place every time
 * is who made the change.
 *
 * A mention is the exception and keeps its words: there the message is a
 * person writing to this reader, which no summary of it replaces. Rows the
 * platform raised by itself have no author and get no line.
 */
export function notificationByline(
  notification: Pick<InAppNotificationView, "actor_name" | "mentioned" | "message" | "title">,
): { text: string; quoted: boolean } | null {
  const message = notification.message?.trim();
  if (notification.mentioned && message && message !== notification.title.trim()) {
    return { text: `“${message}”`, quoted: true };
  }
  const actor = notification.actor_name?.trim();
  return actor ? { text: `By ${actor}`, quoted: false } : null;
}

/** Meta-line wording for each notification type. */
const CATEGORY_LABELS: Record<InAppNotificationCategory, string> = {
  decision: "Decision",
  risk: "Risk",
  demo: "Demo",
  status_update: "Status update",
  roadmap_change: "Roadmap change",
  dependency: "Dependency",
  collateral: "Collateral",
  due: "Due",
  platform_health: "Platform",
  general: "Update",
};

export function categoryLabel(category: InAppNotificationCategory): string {
  return CATEGORY_LABELS[category] ?? "Update";
}

export function notificationAccent(
  notification: Pick<
    InAppNotificationView,
    "severity" | "needs_attention" | "category"
  >,
): string {
  if (notification.needs_attention || notification.severity === "error") {
    return "text-destructive";
  }
  // Everything else is the same colour. Importance is the only thing worth
  // breaking a reader's scan for, and an amber-for-warning, green-for-done
  // palette alongside it just makes the one colour that matters compete.
  return "text-muted-foreground";
}

/**
 * Which part of the product a row came from.
 *
 * Read off the same category list as the "TOME notifications" preference, so
 * what the inbox labels TOME is exactly what that toggle hides — a row that
 * says TOME and survives turning TOME off would be a lie.
 */
export function notificationOrigin(
  notification: Pick<InAppNotificationView, "category">,
): "TOME" | "Platform" {
  return TOME_NOTIFICATION_CATEGORIES.includes(notification.category)
    ? "TOME"
    : "Platform";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Right-aligned timestamp. Today's rows show a clock time, older ones a date —
 * the same split a mail client makes, because "09:40" is only meaningful if
 * you already know the day.
 */
export function notificationTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < DAY && date.getDate() === new Date().getDate()) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Day-bucket heading, matching how people scan a feed by recency. */
export function notificationDayGroup(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "Earlier";

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const daysAgo = Math.floor((startOfToday.getTime() - date.getTime()) / DAY);

  if (date.getTime() >= startOfToday.getTime()) return "Today";
  if (daysAgo < 1) return "Yesterday";
  if (daysAgo < 7) return "Last week";
  if (daysAgo < 30) return "Last month";
  return "Earlier";
}

/** Stable display order for the day buckets above. */
export const DAY_GROUP_ORDER: readonly string[] = [
  "Today",
  "Yesterday",
  "Last week",
  "Last month",
  "Earlier",
];

export function groupByDay<T extends { created_at: string }>(
  notifications: readonly T[],
): Array<{ group: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const notification of notifications) {
    const key = notificationDayGroup(notification.created_at);
    const bucket = buckets.get(key) ?? [];
    bucket.push(notification);
    buckets.set(key, bucket);
  }
  return DAY_GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
    group,
    items: buckets.get(group) ?? [],
  }));
}

/**
 * Split the list into TOME and Platform, in that order.
 *
 * The order is fixed rather than by size: TOME is the reader's own work and
 * platform news is the backdrop to it, so a quiet week for TOME should not
 * push it below the noise.
 */
export function groupByOrigin<T extends { category: InAppNotificationCategory }>(
  notifications: readonly T[],
): Array<{ group: string; items: T[] }> {
  const tome: T[] = [];
  const platform: T[] = [];
  for (const notification of notifications) {
    (notificationOrigin(notification) === "TOME" ? tome : platform).push(notification);
  }
  return [
    { group: "TOME", items: tome },
    { group: "Platform", items: platform },
  ].filter((section) => section.items.length > 0);
}

/** Everything a row must carry before its type can be worked out. */
interface TypedRow {
  action?: NotificationAction;
  category: InAppNotificationCategory;
  created_at: string;
  event_label?: string;
  lifecycle_status?: InAppNotificationLifecycleStatus;
  mentioned?: boolean;
}

/**
 * What a row announces, with "new" allowed to expire.
 *
 * Something raised two months ago is not news, so past the window it reads
 * as a change to the space rather than an addition to it. The stored action
 * is untouched — it records what happened, which does not change.
 */
function resolvedAction(notification: TypedRow): NotificationAction {
  const action = notification.action ?? notificationAction(notification);
  if (action === "new" && !isStillNew(notification.created_at)) return "updated";
  return action;
}

/**
 * The row's type, in the Type filter's own words.
 *
 * Being tagged outranks whether the artifact is new or changed: it is the
 * only one of the three that says the row was addressed to this reader, and
 * that is what they need to know first.
 */
export function notificationType(notification: TypedRow): string {
  if (notification.mentioned) return "Tagged";
  const action = resolvedAction(notification);
  return (
    NOTIFICATION_TYPE_FACETS.find((facet) => facet.action === action)?.label ??
    "New"
  );
}

/**
 * Split the list by what happened, matching the Type filter's own words.
 *
 * Tagged, then New, then Updated: most-addressed-to-you first. Grouped on
 * the action rather than the event label, which is nearly unique per row and
 * would produce a heading for almost every notification.
 */
export function groupByAction<T extends TypedRow>(
  notifications: readonly T[],
): Array<{ group: string; items: T[] }> {
  const tagged: T[] = [];
  const buckets = new Map<NotificationAction, T[]>();
  for (const notification of notifications) {
    // Tagged is its own heading rather than a flag inside New or Updated:
    // being addressed by name is the thing a reader scans for, and splitting
    // it across two other sections buries it.
    if (notification.mentioned) {
      tagged.push(notification);
      continue;
    }
    const action = resolvedAction(notification);
    buckets.set(action, [...(buckets.get(action) ?? []), notification]);
  }
  return [
    ...(tagged.length > 0 ? [{ group: "Tagged", items: tagged }] : []),
    ...NOTIFICATION_TYPE_FACETS.filter(({ action }) => buckets.has(action)).map(
      ({ action, label }) => ({ group: label, items: buckets.get(action) ?? [] }),
    ),
  ];
}

/** The fields a row needs before it can offer a link. */
interface LinkedRow {
  title: string;
  href?: string;
  entity_slug?: string;
  entity_title?: string;
  entity_type?: "bhag" | "area" | "project";
}

function entityNoun(type?: string): string {
  if (type === "bhag") return "BHAG";
  if (type === "area") return "Area";
  return "Project";
}

/**
 * The row's link to the artifact, if it has one.
 *
 * A notification's href is sometimes the artifact itself — a wiki page, a
 * gist, an issue — and sometimes no more than the entity it happened in. Only
 * the first is an "Open": the second is navigation, and when that navigation
 * is the summary already on screen it is a button that does nothing. Rather
 * than offer a dead link, the row offers none.
 */
export function artifactLink(
  item: LinkedRow,
  /** Entity whose summary is being read, when the row sits on one. */
  viewing?: string,
): { href: string; label: string; aria: string; external: boolean } | null {
  const href = item.href?.trim();
  if (!href) return null;
  const open = { href, label: "Open", aria: `Open: ${item.title}` };
  if (/^https?:\/\//i.test(href)) return { ...open, external: true };
  // Nothing to compare against, so the target can only be the artifact.
  if (!item.entity_slug) return { ...open, external: false };

  const landing = `/projects/${encodeURIComponent(item.entity_slug)}/tome`;
  if (href !== landing && href !== `${landing}/`) return { ...open, external: false };
  if (item.entity_slug === viewing) return null;
  // Honest about what happens: this changes which entity you are reading, it
  // does not open the item. The visible label stays short because the row's
  // meta line already names the entity; the accessible one cannot lean on
  // that, so it spells the entity out.
  return {
    href,
    label: `Go to ${entityNoun(item.entity_type)}`,
    aria: `Go to ${item.entity_title}`,
    external: false,
  };
}
