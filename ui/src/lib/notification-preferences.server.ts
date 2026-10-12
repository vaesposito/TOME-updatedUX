import { getCollection } from "@/lib/mongodb";
import type { UserSettings } from "@/types/mongodb";
import type { NotificationPreferences } from "@/types/in-app-notification";

export async function platformHealthNotificationsEnabled(
  userEmail: string,
): Promise<boolean> {
  const normalizedEmail = userEmail.trim();
  if (!normalizedEmail) return true;

  const settings = await getCollection<UserSettings>("user_settings");
  const userSettings = await settings.findOne({ user_id: normalizedEmail });
  return userSettings?.notifications?.platform_health !== false;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  muted_entity_slugs: [],
};

/**
 * The notification-page preferences: the entities this user has muted.
 *
 * Stored alongside the other per-user notification settings in
 * `user_settings`, keyed by email like the rest of that document.
 */
export async function getNotificationPreferences(
  userEmail: string,
): Promise<NotificationPreferences> {
  const email = userEmail.trim();
  if (!email) return DEFAULT_NOTIFICATION_PREFERENCES;

  const settings = await getCollection<UserSettings>("user_settings");
  const row = await settings.findOne({ user_id: email });
  return {
    muted_entity_slugs: row?.notifications?.tome_muted_entity_slugs ?? [],
  };
}

export async function setEntityMuted(
  userEmail: string,
  entitySlugs: readonly string[],
  muted: boolean,
): Promise<NotificationPreferences> {
  const email = userEmail.trim();
  const slugs = [...new Set(entitySlugs.map((slug) => slug.trim()).filter(Boolean))];
  if (!email || slugs.length === 0) return getNotificationPreferences(email);

  const settings = await getCollection<UserSettings>("user_settings");
  await settings.updateOne(
    { user_id: email },
    {
      ...(muted
        ? { $addToSet: { "notifications.tome_muted_entity_slugs": { $each: slugs } } }
        : { $pullAll: { "notifications.tome_muted_entity_slugs": slugs } }),
      $set: { updated_at: new Date() },
    } as never,
    { upsert: true },
  );
  return getNotificationPreferences(email);
}

/**
 * Mongo clauses that apply a user's preferences to a notification query.
 *
 * Returned as a list so callers can splice them into an existing `$and`
 * without caring how many there are.
 */
export function preferenceClauses(
  prefs: NotificationPreferences,
): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [];
  if (prefs.muted_entity_slugs.length > 0) {
    clauses.push({ entity_slug: { $nin: prefs.muted_entity_slugs } });
  }
  return clauses;
}
