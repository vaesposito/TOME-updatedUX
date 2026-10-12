import { randomUUID } from "node:crypto";

import { getCollection } from "@/lib/mongodb";
import {
  getNotificationPreferences,
  preferenceClauses,
} from "@/lib/notification-preferences.server";
import { checkOpenFgaTuple, listOpenFgaObjects } from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";
import {
  TOME_NOTIFICATION_CATEGORIES,
  type GroupedInAppNotificationPage,
  type InAppNotificationDocument,
  type InAppNotificationPage,
  type InAppNotificationCategory,
  type NotificationAction,
  type InAppNotificationLifecycleStatus,
  type InAppNotificationResolutionType,
  type InAppNotificationSeverity,
  type InAppNotificationView,
  type NotificationGroupKey,
} from "@/types/in-app-notification";

const NOTIFICATION_COLLECTION = "in_app_notifications";

function normalizedStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function teamSlugFromObject(value: string): string | null {
  const match = /^team:(.+)$/.exec(value);
  return match?.[1]?.trim() || null;
}

/**
 * Every notification `subject` is allowed to see: addressed to them directly,
 * to a team they belong to, to organization admins when they are one, or to
 * all platform users. Archived rows never appear.
 */
export async function notificationAudienceQuery(
  subject: string,
  options: { includePlatformNotifications?: boolean } = {},
): Promise<Record<string, unknown>> {
  let teamSlugs: string[] = [];
  let organizationAdmin = false;
  const [teamResult, adminResult] = await Promise.allSettled([
    listOpenFgaObjects({
      user: `user:${subject}`,
      relation: "member",
      type: "team",
    }),
    checkOpenFgaTuple({
      user: `user:${subject}`,
      relation: "can_manage",
      object: organizationObjectId(),
    }),
  ]);
  if (teamResult.status === "fulfilled") {
    const result = teamResult.value;
    teamSlugs = result.objects
      .map(teamSlugFromObject)
      .filter((value): value is string => Boolean(value));
  } else {
    console.error(
      "[notifications] could not resolve team memberships",
      teamResult.reason,
    );
  }
  if (adminResult.status === "fulfilled") {
    organizationAdmin = adminResult.value.allowed;
  } else {
    console.error(
      "[notifications] could not resolve organization access",
      adminResult.reason,
    );
  }
  return {
    archived_at: { $exists: false },
    ...(options.includePlatformNotifications === false
      ? { category: { $ne: "platform_health" } }
      : {}),
    $or: [
      { recipient_user_subjects: subject },
      ...(teamSlugs.length > 0
        ? [{ recipient_team_slugs: { $in: teamSlugs } }]
        : []),
      ...(organizationAdmin ? [{ recipient_organization_admins: true }] : []),
      { recipient_platform_users: true },
    ],
  };
}

export async function createInAppNotification(input: {
  eventKey: string;
  recipientUserSubjects?: string[];
  recipientTeamSlugs?: string[];
  recipientOrganizationAdmins?: boolean;
  recipientPlatformUsers?: boolean;
  title: string;
  message: string;
  href?: string;
  severity?: InAppNotificationSeverity;
  category?: InAppNotificationCategory;
  /** Whether this announces something new or a change to something existing. */
  action?: NotificationAction;
  sourceLabel?: string;
  correlationKey?: string;
  lifecycleStatus?: InAppNotificationLifecycleStatus;
  /** Tome entity this is about — drives the inbox's per-project facet. */
  entitySlug?: string;
  entityTitle?: string;
  parentEntitySlug?: string;
  /** Meta-line phrasing, e.g. "Due in 2 days". Defaults to the category label. */
  eventLabel?: string;
  reference?: string;
  /** Who made the change, shown on the row instead of a hand-written line. */
  actorName?: string;
  needsAttention?: boolean;
  /** Recipients explicitly mentioned or assigned; must be inside the audience. */
  mentionSubjects?: string[];
}): Promise<void> {
  const recipientUserSubjects = normalizedStrings(input.recipientUserSubjects ?? []);
  const recipientTeamSlugs = normalizedStrings(input.recipientTeamSlugs ?? []);
  const recipientOrganizationAdmins = input.recipientOrganizationAdmins === true;
  const recipientPlatformUsers = input.recipientPlatformUsers === true;
  if (
    recipientUserSubjects.length === 0 &&
    recipientTeamSlugs.length === 0 &&
    !recipientOrganizationAdmins &&
    !recipientPlatformUsers
  ) return;

  const collection = await getCollection<InAppNotificationDocument>(
    NOTIFICATION_COLLECTION,
  );
  const now = new Date().toISOString();
  await collection.updateOne(
    { event_key: input.eventKey } as never,
    {
      $setOnInsert: {
        _id: randomUUID(),
        event_key: input.eventKey,
        recipient_user_subjects: recipientUserSubjects,
        recipient_team_slugs: recipientTeamSlugs,
        recipient_organization_admins: recipientOrganizationAdmins,
        recipient_platform_users: recipientPlatformUsers,
        title: input.title,
        message: input.message,
        ...(input.href ? { href: input.href } : {}),
        severity: input.severity ?? "info",
        category: input.category ?? "general",
        ...(input.action ? { action: input.action } : {}),
        ...(input.sourceLabel ? { source_label: input.sourceLabel } : {}),
        ...(input.correlationKey ? { correlation_key: input.correlationKey } : {}),
        ...(input.lifecycleStatus ? { lifecycle_status: input.lifecycleStatus } : {}),
        ...(input.entitySlug ? { entity_slug: input.entitySlug } : {}),
        ...(input.entityTitle ? { entity_title: input.entityTitle } : {}),
        ...(input.parentEntitySlug
          ? { parent_entity_slug: input.parentEntitySlug }
          : {}),
        ...(input.eventLabel ? { event_label: input.eventLabel } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.actorName ? { actor_name: input.actorName } : {}),
        ...(input.needsAttention ? { needs_attention: true } : {}),
        ...(input.mentionSubjects?.length
          ? { mention_subjects: normalizedStrings(input.mentionSubjects) }
          : {}),
        created_at: now,
        updated_at: now,
        read_by_subjects: [],
        dismissed_by_subjects: [],
      },
    } as never,
    { upsert: true },
  );
}

export async function resolveInAppNotification(input: {
  eventKey: string;
  resolvedAt: string;
  resolvedBySubject?: string;
  resolutionType: InAppNotificationResolutionType;
  resolutionNote?: string;
}): Promise<boolean> {
  const collection = await getCollection<InAppNotificationDocument>(
    NOTIFICATION_COLLECTION,
  );
  const result = await collection.updateOne(
    { event_key: input.eventKey, archived_at: { $exists: false } } as never,
    {
      $set: {
        lifecycle_status: "resolved",
        resolved_at: input.resolvedAt,
        resolution_type: input.resolutionType,
        ...(input.resolvedBySubject
          ? { resolved_by_subject: input.resolvedBySubject }
          : {}),
        ...(input.resolutionNote ? { resolution_note: input.resolutionNote } : {}),
        updated_at: input.resolvedAt,
      },
    } as never,
  );
  return result.matchedCount > 0;
}

export async function archiveInAppNotifications(
  eventKeys: string[],
): Promise<void> {
  const keys = normalizedStrings(eventKeys);
  if (keys.length === 0) return;
  const collection = await getCollection<InAppNotificationDocument>(
    NOTIFICATION_COLLECTION,
  );
  const now = new Date().toISOString();
  await collection.updateMany(
    { event_key: { $in: keys }, archived_at: { $exists: false } } as never,
    { $set: { archived_at: now, updated_at: now } } as never,
  );
}

function toView(
  row: InAppNotificationDocument,
  subject: string,
): InAppNotificationView {
  return {
    id: row._id,
    title: row.title,
    message: row.message,
    ...(row.href ? { href: row.href } : {}),
    severity: row.severity,
    category: row.category ?? "general",
    ...(row.source_label ? { source_label: row.source_label } : {}),
    ...(row.lifecycle_status ? { lifecycle_status: row.lifecycle_status } : {}),
    ...(row.resolved_at ? { resolved_at: row.resolved_at } : {}),
    ...(row.entity_slug ? { entity_slug: row.entity_slug } : {}),
    ...(row.entity_title ? { entity_title: row.entity_title } : {}),
    ...(row.event_label ? { event_label: row.event_label } : {}),
    // Carried through so the dropdown calls a row what the inbox calls it.
    // Derived from the event label when absent, which guesses "Updated" for
    // labels like "Summary digest" that the stored action records as new.
    ...(row.action ? { action: row.action } : {}),
    ...(row.reference ? { reference: row.reference } : {}),
    ...(row.actor_name ? { actor_name: row.actor_name } : {}),
    created_at: row.created_at,
    read: row.read_by_subjects.includes(subject),
    needs_attention: row.needs_attention === true,
    mentioned: (row.mention_subjects ?? []).includes(subject),
    dismissed: (row.dismissed_by_subjects ?? []).includes(subject),
    // The dropdown has no Follow affordance; the full inbox resolves this.
    following: false,
  };
}

export async function listInAppNotifications(
  subject: string,
  options: {
    page?: number;
    pageSize?: number;
    includePlatformNotifications?: boolean;
    /** Needed to read preferences, which `user_settings` keys by email. */
    email?: string;
  } = {},
): Promise<InAppNotificationPage> {
  const collection = await getCollection<InAppNotificationDocument>(
    NOTIFICATION_COLLECTION,
  );
  // The dropdown shows the same universe as the inbox: muted entities and a
  // disabled Tome switch are honoured here too, and anything the reader has
  // dismissed stays gone rather than reappearing in the bell.
  const prefs = await getNotificationPreferences(options.email ?? "");
  const audience = {
    $and: [
      await notificationAudienceQuery(subject, options),
      ...preferenceClauses(prefs),
      { dismissed_by_subjects: { $ne: subject } },
    ],
  };
  const requestedPage = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize ?? 10)));
  const [total, unreadCount] = await Promise.all([
    collection.countDocuments(audience as never),
    collection.countDocuments({
      $and: [audience, { read_by_subjects: { $ne: subject } }],
    } as never),
  ]);
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const page = Math.min(requestedPage, totalPages);
  const rows = await collection
    .find(audience as never)
    .sort({ created_at: -1, _id: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray();

  return {
    notifications: rows.map((row) => toView(row, subject)),
    unread_count: unreadCount,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: totalPages,
    },
  };
}

/**
 * The bell's two groups, each queried on its own.
 *
 * Fetching one flat page and splitting it in the browser would let a burst in
 * one group push the other out of the top rows entirely, and the dropdown
 * would then look as though there were no Tome activity at all. Querying per
 * group guarantees each section shows its own newest, and reports its own
 * totals so a header can be honest about what is not being shown.
 */
export async function listGroupedInAppNotifications(
  subject: string,
  options: {
    /** Rows returned per group; both groups get the same allowance. */
    perGroup?: number;
    includePlatformNotifications?: boolean;
    email?: string;
  } = {},
): Promise<GroupedInAppNotificationPage> {
  const collection = await getCollection<InAppNotificationDocument>(
    NOTIFICATION_COLLECTION,
  );
  const prefs = await getNotificationPreferences(options.email ?? "");
  const audience = {
    $and: [
      await notificationAudienceQuery(subject, options),
      ...preferenceClauses(prefs),
      { dismissed_by_subjects: { $ne: subject } },
    ],
  };
  const perGroup = Math.min(25, Math.max(1, Math.floor(options.perGroup ?? 6)));
  const tomeCategories = [...TOME_NOTIFICATION_CATEGORIES];

  const groups = await Promise.all(
    (["tome", "platform"] as const).map(async (key: NotificationGroupKey) => {
      // `$nin` also matches documents with no category at all, so rows
      // written before categories existed stay visible under Platform
      // rather than falling out of the bell entirely.
      const scoped = {
        $and: [
          audience,
          key === "tome"
            ? { category: { $in: tomeCategories } }
            : { category: { $nin: tomeCategories } },
        ],
      };
      const [rows, total, unread] = await Promise.all([
        collection
          .find(scoped as never)
          .sort({ created_at: -1, _id: -1 })
          .limit(perGroup)
          .toArray(),
        collection.countDocuments(scoped as never),
        collection.countDocuments({
          $and: [scoped, { read_by_subjects: { $ne: subject } }],
        } as never),
      ]);
      return {
        key,
        notifications: rows.map((row) => toView(row, subject)),
        unread_count: unread,
        total,
      };
    }),
  );

  return {
    notifications: groups.flatMap((group) => group.notifications),
    unread_count: groups.reduce((sum, group) => sum + group.unread_count, 0),
    pagination: {
      page: 1,
      page_size: perGroup,
      total: groups.reduce((sum, group) => sum + group.total, 0),
      total_pages: 1,
    },
    groups,
  };
}

export async function markInAppNotificationRead(
  subject: string,
  id: string,
  options: { includePlatformNotifications?: boolean } = {},
): Promise<boolean> {
  const collection = await getCollection<InAppNotificationDocument>(
    NOTIFICATION_COLLECTION,
  );
  const audience = await notificationAudienceQuery(subject, options);
  const result = await collection.updateOne(
    { $and: [{ _id: id }, audience] } as never,
    {
      $addToSet: { read_by_subjects: subject },
      $set: { updated_at: new Date().toISOString() },
    } as never,
  );
  return result.matchedCount > 0;
}

export async function markAllInAppNotificationsRead(
  subject: string,
  options: { includePlatformNotifications?: boolean } = {},
): Promise<number> {
  const collection = await getCollection<InAppNotificationDocument>(
    NOTIFICATION_COLLECTION,
  );
  const audience = await notificationAudienceQuery(subject, options);
  const result = await collection.updateMany(
    { $and: [audience, { read_by_subjects: { $ne: subject } }] } as never,
    {
      $addToSet: { read_by_subjects: subject },
      $set: { updated_at: new Date().toISOString() },
    } as never,
  );
  return result.modifiedCount;
}
