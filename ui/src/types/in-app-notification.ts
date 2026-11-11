export type InAppNotificationSeverity =
  | "info"
  | "success"
  | "warning"
  | "error";

/**
 * What a notification is *about*. Drives the inbox type facets and the row
 * icon, and `platform_health` additionally controls audience (see
 * `includePlatformNotifications`).
 *
 * `general` is the fallback for anything that predates the typed set.
 */
export type InAppNotificationCategory =
  | "general"
  | "platform_health"
  | "decision"
  | "risk"
  | "demo"
  | "status_update"
  | "roadmap_change"
  | "dependency"
  | "collateral"
  | "due";

/**
 * What happened, as opposed to what it happened to.
 *
 * Every notification is one or the other: something came into existence, or
 * something that already existed changed. An alert about a service going down
 * counts as new — the alert itself is the new thing — and a service coming
 * back is a change to it.
 */
export type NotificationAction = "new" | "updated";

/**
 * How long something counts as new.
 *
 * Past this it is simply part of the space, and calling a month-old page
 * "New" in a digest trains readers to ignore the word.
 */
export const NEW_FOR_DAYS = 7;

/**
 * Type facets in the inbox filter bar, in display order.
 *
 * Tagged leads: it is the only one of the three that says the row was
 * addressed to this reader, which is what they need to know first. New
 * before Updated, because arriving precedes changing.
 */
export const NOTIFICATION_TYPE_FACETS: ReadonlyArray<{
  action: NotificationAction;
  label: string;
}> = [
  { action: "new", label: "New" },
  { action: "updated", label: "Updated" },
];

/**
 * Whether something raised at `createdAt` is still new.
 *
 * Age is applied to the label rather than to the stored action: the action
 * is a fact about the event and does not change, while "new" is a claim
 * about now and expires.
 */
export function isStillNew(createdAt: string): boolean {
  const raised = new Date(createdAt).getTime();
  if (!Number.isFinite(raised)) return false;
  return Date.now() - raised < NEW_FOR_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Phrasing that gives away what happened, for rows that predate the `action`
 * field. Checked in this order: "New status update" is new, not an update.
 */
const RAISED_WORDING = /\b(new|published|raised|created|added|opened|recorded)\b/i;
const CHANGED_WORDING = /\b(updated?|changed?|resolved?|decided|recovered|restored|status)\b/i;

/**
 * What a notification announces, inferred when it was not recorded.
 *
 * Senders write the `action` now, so inference only covers rows already in
 * the store. For those the sender's own phrasing is the best evidence, and a
 * settled row is by definition a change to something raised earlier.
 */
export function notificationAction(
  notification: Pick<
    InAppNotificationDocument,
    "action" | "category" | "event_label" | "lifecycle_status"
  >,
): NotificationAction {
  if (notification.action) return notification.action;
  if (notification.lifecycle_status === "resolved") return "updated";

  const label = notification.event_label ?? "";
  if (RAISED_WORDING.test(label)) return "new";
  if (CHANGED_WORDING.test(label)) return "updated";

  // Nothing to go on. These two categories only ever report a change; the
  // rest announce something that was not there before, including an alert,
  // where the alert itself is the new thing.
  return notification.category === "status_update" ||
    notification.category === "roadmap_change"
    ? "updated"
    : "new";
}

/** Categories that come from Tome, gated by the "TOME notifications" toggle. */
export const TOME_NOTIFICATION_CATEGORIES: readonly InAppNotificationCategory[] = [
  "decision",
  "risk",
  "demo",
  "status_update",
  "roadmap_change",
  "dependency",
  "collateral",
  "due",
];

/** Which part of the product a notification came from. */
export type NotificationOrigin = "tome" | "platform";

export const NOTIFICATION_ORIGIN_LABELS: Record<NotificationOrigin, string> = {
  tome: "TOME",
  platform: "Platform",
};

export type InAppNotificationLifecycleStatus = "active" | "resolved";
export type InAppNotificationResolutionType = "automatic_audit" | "human";

export interface InAppNotificationDocument {
  _id: string;
  event_key: string;
  recipient_user_subjects: string[];
  recipient_team_slugs: string[];
  recipient_organization_admins: boolean;
  recipient_platform_users?: boolean;
  title: string;
  message: string;
  href?: string;
  severity: InAppNotificationSeverity;
  category?: InAppNotificationCategory;
  /**
   * Whether this announces something new or a change to something existing.
   * Optional because rows written before the inbox filtered on it have none;
   * `notificationAction()` infers one for those.
   */
  action?: NotificationAction;
  source_label?: string;
  correlation_key?: string;
  lifecycle_status?: InAppNotificationLifecycleStatus;
  resolved_at?: string;
  resolved_by_subject?: string;
  resolution_type?: InAppNotificationResolutionType;
  resolution_note?: string;
  created_at: string;
  updated_at: string;
  read_by_subjects: string[];
  archived_at?: string;

  // --- Inbox presentation and faceting -------------------------------------
  /** Tome entity this is about — powers the per-project facet and the Follow action. */
  entity_slug?: string;
  /** Display name of that entity, shown in the row's meta line. */
  entity_title?: string;
  /** Parent entity slug, so the project facet can nest an Area under its BHAG. */
  parent_entity_slug?: string;
  /**
   * Event phrasing for the meta line, e.g. "Due in 2 days" or "Dependency at
   * risk". Falls back to the category's label when absent.
   */
  event_label?: string;
  /** External reference shown on the right, e.g. "IoC-BHAG#78". */
  reference?: string;
  /**
   * Who made the change, for display.
   *
   * A field rather than prose inside `message`, because every row wants to
   * answer "who did this" and senders phrased it differently or not at all.
   * Absent on anything the platform raised by itself, which has no author.
   */
  actor_name?: string;
  /** Surfaces in the "Needs attention" facet and renders the row as urgent. */
  needs_attention?: boolean;
  /** Recipients explicitly mentioned or assigned, a subset of the audience. */
  mention_subjects?: string[];
  /** Per-user dismissal — mirrors `read_by_subjects` because rows are shared. */
  dismissed_by_subjects?: string[];
}

export interface InAppNotificationView {
  id: string;
  title: string;
  message: string;
  href?: string;
  severity: InAppNotificationSeverity;
  category: InAppNotificationCategory;
  action?: NotificationAction;
  source_label?: string;
  lifecycle_status?: InAppNotificationLifecycleStatus;
  resolved_at?: string;
  created_at: string;
  read: boolean;
  entity_slug?: string;
  entity_title?: string;
  event_label?: string;
  reference?: string;
  actor_name?: string;
  needs_attention: boolean;
  /** True when this recipient was mentioned or assigned, not just an audience member. */
  mentioned: boolean;
  dismissed: boolean;
  /** Whether this recipient watches `entity_slug` — drives the Follow action. */
  following: boolean;
}

export interface InAppNotificationPage {
  notifications: InAppNotificationView[];
  unread_count: number;
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

/**
 * The bell splits its list in two: work coming out of Tome, and everything
 * else the platform raises. They are read for different reasons — one is your
 * projects moving, the other is the system needing attention — so mixing them
 * by timestamp alone buries whichever is quieter that day.
 */
export type NotificationGroupKey = "tome" | "platform";

export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroupKey, string> = {
  tome: "TOME",
  platform: "Platform",
};

export interface InAppNotificationGroup {
  key: NotificationGroupKey;
  notifications: InAppNotificationView[];
  /** Unread across the whole group, not only the rows returned. */
  unread_count: number;
  /** Everything in the group, so the header can say what is being withheld. */
  total: number;
}

export interface GroupedInAppNotificationPage extends InAppNotificationPage {
  groups: InAppNotificationGroup[];
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/**
 * Which of the notification page's two places to show.
 *
 * Distinct from `NotificationInboxTab` below, which slices the Inbox's own
 * list. These are destinations; those are filters.
 */
export type NotificationPageView = "inbox" | "following";

/** Which slice of the inbox to show. */
export type NotificationInboxTab = "unread" | "all" | "dismissed";

/**
 * Sidebar filters, which combine rather than replace each other: "important
 * decisions in this BHAG" is a question people actually ask, and it needs all
 * three dimensions at once.
 *
 * An empty filter is the whole inbox.
 */
export interface NotificationInboxFilter {
  /**
   * One BHAG, Area or Project. Matching includes everything beneath it, since
   * the upper two tiers rarely carry notifications of their own.
   */
  entity?: string;
  /** Actions to include. Empty means both. */
  actions: NotificationAction[];
  /** Only rows flagged as needing attention. */
  important: boolean;
  /**
   * Only rows where this reader was mentioned or assigned.
   *
   * Sits alongside `actions` under the Type control even though it is a
   * different kind of question — "what happened" versus "does it involve me".
   * The two widen the result together rather than narrowing it: asking for
   * updated or tagged means either, which is what picking both in one
   * dropdown looks like it should do.
   */
  tagged: boolean;
  /**
   * Which half of the product to show, or null for both.
   *
   * Named after the tag each row already wears, and resolved from the same
   * category list, so picking TOME here shows exactly the rows labelled TOME.
   */
  origin: NotificationOrigin | null;
}

export const EMPTY_NOTIFICATION_FILTER: NotificationInboxFilter = {
  actions: [],
  important: false,
  tagged: false,
  origin: null,
};

export function isEmptyNotificationFilter(
  filter: NotificationInboxFilter,
): boolean {
  return (
    !filter.entity &&
    filter.actions.length === 0 &&
    !filter.important &&
    !filter.tagged &&
    !filter.origin
  );
}

export interface NotificationEntityFacet {
  entity_slug: string;
  entity_title: string;
  /** BHAG, Area or Project — the sidebar groups and indents by this. */
  entity_type: "bhag" | "area" | "project";
  /** Present when this entity sits under another, so the list can indent it. */
  parent_entity_slug?: string;
  /**
   * Unread in this entity and everything beneath it. A BHAG's own rows are
   * almost always zero, so the subtree total is the only useful number.
   */
  unread: number;
  muted: boolean;
}

/**
 * Counts behind every sidebar entry.
 *
 * Each group is counted with the *other* filters applied but not its own, the
 * way faceted search normally behaves: after picking a BHAG you want to see
 * which types have unread work inside it, and a type showing 0 should mean
 * "none here", not "none anywhere".
 */
export interface NotificationInboxFacets {
  /** The unfiltered total, which is also what clearing the filter returns. */
  everything: number;
  needs_attention: number;
  mentions: number;
  by_action: Partial<Record<NotificationAction, number>>;
  /** Backs the TOME / Platform quick filter's counts. */
  by_origin: Partial<Record<NotificationOrigin, number>>;
  by_entity: NotificationEntityFacet[];
}

export interface NotificationInboxResponse {
  notifications: InAppNotificationView[];
  facets: NotificationInboxFacets;
  /** Echoed back so the client can trust what the server actually applied. */
  filter: NotificationInboxFilter;
  /** Total rows matching the current tab and filter. */
  total: number;
  counts: { unread: number; all: number; dismissed: number };
  preferences: NotificationPreferences;
}

export interface NotificationPreferences {
  /** Entity slugs whose notifications this user has muted. */
  muted_entity_slugs: string[];
}

/**
 * One row of the Watching tab's tree.
 *
 * The tab lists the whole readable hierarchy rather than only what is already
 * watched, because it is where someone decides what to follow — and the thing
 * you want to start following is by definition not in your list yet.
 */
export interface NotificationFollowTreeNode {
  /** Unique within the tree, and the entity's own slug. */
  slug: string;
  title: string;
  /** Following is a space-level idea: a single wiki page cannot be followed. */
  type: "bhag" | "area" | "project";
  /** Absent for a root, or when the tier above is not readable. */
  parent_slug?: string;
  /** The entity a node belongs to. For an entity node, its own slug. */
  entity_slug: string;
  following: boolean;
  /** Notifications from this entity are suppressed, watched or not. */
  muted: boolean;
  /** Unread on this entity alone. */
  unread: number;
  /**
   * Unread across this entity and everything beneath it. A BHAG carries
   * almost nothing of its own, so this is the number worth showing.
   */
  subtree_unread: number;
}

export interface NotificationFollowTree {
  /**
   * Flat and depth-first; the client rebuilds the shape from `parent_slug`.
   *
   * Every readable entity is listed, but only the wiki pages this reader
   * already watches: a wiki can hold hundreds of pages, so they are added by
   * watching them from the page itself rather than browsed here.
   */
  nodes: NotificationFollowTreeNode[];
  /** Unread across everything readable, for the "Select all" row. */
  total_unread: number;
}
