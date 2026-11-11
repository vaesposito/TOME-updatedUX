/**
 * Per-user watch subscriptions on Tome entities (Projects, Areas, BHAGs).
 *
 * A subscription covers a whole entity. Single wiki pages cannot be watched,
 * and nothing here writes a row for one, but a collection that has been live
 * may still hold rows carrying `page_path` from when they could. Those rows
 * subscribe to nobody and must never be read as a subscription to the entity
 * they name, which is why every query below filters on `ENTITY_ONLY`.
 *
 * Watching is a notification routing choice, not an access grant: a watcher
 * only ever receives notifications for an entity they could already read, and
 * read access is re-checked at delivery time rather than trusted from the
 * subscription row.
 *
 * Server-only.
 */

import { randomUUID } from "crypto";

import { createInAppNotification } from "@/lib/in-app-notifications.server";
import { getCollection } from "@/lib/mongodb";
import type {
  InAppNotificationCategory,
  InAppNotificationSeverity,
} from "@/types/in-app-notification";
import type { ProjectType } from "@/types/projects";
import type {
  WebexDeliveryCadence,
  WebexDeliveryDestination,
} from "@/types/webex-delivery";

export const WATCHER_COLLECTION = "tome_watchers";

/**
 * A watch's Webex delivery rule, plus the bookkeeping a digest needs.
 *
 * Kept on the subscription rather than in a collection of its own: a rule is
 * meaningless without the watch it belongs to, and holding them together
 * means unwatching cannot leave an orphan rule that silently starts sending
 * again if the entity is ever watched a second time.
 *
 * Absent means never configured, which the UI shows as Off.
 */
export interface TomeWatcherWebexDelivery {
  destination: WebexDeliveryDestination;
  space_id?: string;
  space_name?: string;
  cadence: WebexDeliveryCadence;
  hour: number;
  weekday: number;
  timezone: string;
  updated_at: string;
  /**
   * When the next digest is due. Absent on `immediate`, which has no cycle.
   *
   * Stored rather than recomputed per tick so a lagging or restarted
   * scheduler cannot decide a digest was never owed, and so the due time
   * survives a change of server timezone.
   */
  next_run_at?: string;
  last_run_at?: string;
  /**
   * Lease held while a replica is sending this digest.
   *
   * The claim is what stops two servers sending the same digest twice; it
   * expires so that a replica dying mid-send does not strand the rule.
   */
  claimed_until?: string;
}

export interface TomeWatcherDocument {
  _id: string;
  entity_slug: string;
  entity_type: ProjectType;
  /**
   * Never written any more: a page cannot be followed. Declared so that the
   * filters excluding these rows keep type-checking against the shape they
   * exclude.
   */
  page_path?: string;
  subject: string;
  email?: string;
  created_at: string;
  /** Where this watch's notifications go in Webex. */
  webex_delivery?: TomeWatcherWebexDelivery;
}

/** Matches live rows only, never a page row left behind by an older schema. */
const ENTITY_ONLY = { page_path: { $exists: false } } as const;

export interface TomeWatchState {
  watching: boolean;
  watcher_count: number;
}

async function watchers() {
  return getCollection<TomeWatcherDocument>(WATCHER_COLLECTION);
}

/** Scope for one subscription: the whole entity. */
function scope(entitySlug: string) {
  return { entity_slug: entitySlug, ...ENTITY_ONLY };
}

export async function isWatchingEntity(
  entitySlug: string,
  subject: string,
): Promise<boolean> {
  if (!entitySlug || !subject) return false;
  const collection = await watchers();
  const row = await collection.findOne({ ...scope(entitySlug), subject });
  return Boolean(row);
}

export async function countEntityWatchers(entitySlug: string): Promise<number> {
  if (!entitySlug) return 0;
  const collection = await watchers();
  return collection.countDocuments(scope(entitySlug));
}

export async function getEntityWatchState(
  entitySlug: string,
  subject: string,
): Promise<TomeWatchState> {
  const [watching, watcher_count] = await Promise.all([
    isWatchingEntity(entitySlug, subject),
    countEntityWatchers(entitySlug),
  ]);
  return { watching, watcher_count };
}

/** Idempotent: watching an already-watched entity is a no-op. */
export async function watchEntity(input: {
  entitySlug: string;
  entityType: ProjectType;
  subject: string;
  email?: string;
}): Promise<void> {
  if (!input.entitySlug || !input.subject) return;
  const collection = await watchers();
  await collection.updateOne(
    { ...scope(input.entitySlug), subject: input.subject },
    {
      $setOnInsert: {
        _id: randomUUID(),
        entity_slug: input.entitySlug,
        entity_type: input.entityType,
        subject: input.subject,
        ...(input.email ? { email: input.email } : {}),
        created_at: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
}

export async function unwatchEntity(
  entitySlug: string,
  subject: string,
): Promise<void> {
  if (!entitySlug || !subject) return;
  const collection = await watchers();
  await collection.deleteOne({ ...scope(entitySlug), subject });
}

/**
 * Drop every row for an entity, page rows from the older schema included —
 * call when the entity is deleted.
 */
export async function removeAllEntityWatchers(entitySlug: string): Promise<void> {
  if (!entitySlug) return;
  const collection = await watchers();
  await collection.deleteMany({ entity_slug: entitySlug });
}

export async function listEntityWatcherSubjects(
  entitySlug: string,
): Promise<string[]> {
  if (!entitySlug) return [];
  const collection = await watchers();
  const rows = await collection.find({ entity_slug: entitySlug, ...ENTITY_ONLY }).toArray();
  return rows.map((row) => row.subject).filter(Boolean);
}

/**
 * Watchers of this entity who asked to hear about changes in Webex at once.
 *
 * Only the `immediate` rules: the digest cadences are the scheduler's
 * business, and picking them up here too would deliver a change twice.
 */
async function listImmediateWebexWatchers(entitySlug: string): Promise<
  ReadonlyArray<{ subject: string; email?: string; delivery: TomeWatcherWebexDelivery }>
> {
  const collection = await watchers();
  const rows = await collection
    .find({
      entity_slug: entitySlug,
      ...ENTITY_ONLY,
      "webex_delivery.cadence": "immediate",
      "webex_delivery.destination": { $in: ["direct", "space"] },
    } as never)
    .toArray();
  return rows.flatMap((row) =>
    row.webex_delivery
      ? [
          {
            subject: row.subject,
            ...(row.email ? { email: row.email } : {}),
            delivery: row.webex_delivery,
          },
        ]
      : [],
  );
}

/**
 * Push one change to Webex for the watchers who wanted it immediately.
 *
 * Best-effort and never allowed to fail the caller: the in-app notification
 * is the record of the change, and Webex is a convenience on top of it. A
 * space the bot was removed from must not make saving a page fail.
 *
 * Each recipient is sent separately rather than once per space, because two
 * people can route the same project to the same space and both are entitled
 * to be told — de-duplicating here would quietly drop one of them.
 */
async function deliverImmediateWebex(input: {
  entitySlug: string;
  entityTitle: string;
  headline: string;
  actorLabel?: string;
  href: string;
  subjects: readonly string[];
}): Promise<void> {
  const allowed = new Set(input.subjects);
  const targets = (await listImmediateWebexWatchers(input.entitySlug)).filter(
    // The subject list has already had the actor removed and read access
    // re-checked. Routing must not widen it.
    (target) => allowed.has(target.subject),
  );
  if (targets.length === 0) return;

  const { configuredPublicOrigin } = await import("@/lib/tome/public-origin");
  const { deliveryAddress, sendWebexMessage } = await import(
    "@/lib/tome/webex-notifier.server"
  );
  const origin = configuredPublicOrigin();
  const title = origin
    ? `[${input.headline}](${origin}${input.href})`
    : input.headline;
  const markdown = [
    `**${input.entityTitle}** · ${title}`,
    ...(input.actorLabel ? [`By ${input.actorLabel}`] : []),
  ].join("\n");

  await Promise.allSettled(
    targets.map((target) => {
      const address = deliveryAddress({
        destination: target.delivery.destination,
        ...(target.delivery.space_id ? { spaceId: target.delivery.space_id } : {}),
        ...(target.email ? { email: target.email } : {}),
      });
      return address ? sendWebexMessage({ to: address, markdown }) : undefined;
    }),
  );
}

export interface WatchedEntity {
  entity_slug: string;
  entity_title: string;
  entity_type: ProjectType;
  created_at: string;
}

/**
 * Everything a subject watches, with display titles resolved from the project
 * records. A subscription whose entity has since been deleted is dropped
 * rather than shown as a dangling slug.
 */
export async function listSubjectWatchedEntities(
  subject: string,
): Promise<WatchedEntity[]> {
  if (!subject) return [];
  const rows = await (await watchers())
    .find({ subject, ...ENTITY_ONLY })
    .sort({ created_at: -1 })
    .toArray();
  if (rows.length === 0) return [];

  const projects = await getCollection<{ slug: string; title?: string }>(
    "projects",
  );
  const named = await projects
    .find({ slug: { $in: rows.map((row) => row.entity_slug) } })
    .project<{ slug: string; title?: string }>({ slug: 1, title: 1 })
    .toArray();
  const titleBySlug = new Map(named.map((row) => [row.slug, row.title]));

  return rows
    .filter((row) => titleBySlug.has(row.entity_slug))
    .map((row) => ({
      entity_slug: row.entity_slug,
      entity_title: titleBySlug.get(row.entity_slug) || row.entity_slug,
      entity_type: row.entity_type,
      created_at: row.created_at,
    }));
}

/**
 * Changed-field prefixes mapped to what a watcher sees, most specific first.
 * A single edit can touch several fields; the first match wins so the
 * notification names the most meaningful part of the change.
 *
 * The category files the notification under the inbox's type facets, so it has
 * to be a real judgement about what kind of change this is — not a default.
 */
const CHANGE_SUMMARIES: ReadonlyArray<
  readonly [string, string, InAppNotificationCategory]
> = [
  ["labels.initiatives", "Roadmap change", "roadmap_change"],
  ["labels.areas", "Roadmap change", "roadmap_change"],
  ["data_steward", "Data steward change", "status_update"],
  ["sources.", "Sources change", "status_update"],
  ["report_visibility", "Report visibility change", "status_update"],
  ["review_mode", "Review mode change", "status_update"],
  ["auto_ingest", "Ingest schedule change", "status_update"],
  ["decision_blast_radius", "Decision status change", "decision"],
  ["optionality", "Decision status change", "decision"],
  ["team_", "Team change", "status_update"],
  ["title", "Renamed", "status_update"],
  ["description", "Description change", "status_update"],
];

export interface TomeEntityChangeSummary {
  /** Short phrasing shown as the notification headline. */
  label: string;
  category: InAppNotificationCategory;
}

/**
 * Millisecond-precision, timezone-independent stamp for an event key. Mongo
 * hands back `updated_at` as a Date or a string depending on how it was
 * written, and the default stringification of a Date is locale-dependent —
 * which would make the same change produce different keys on different hosts.
 */
export function watchEventStamp(updatedAt: unknown): string {
  const date = new Date(
    typeof updatedAt === "string" || updatedAt instanceof Date
      ? (updatedAt as string | Date)
      : Date.now(),
  );
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

/**
 * Describe an entity edit in a few words, or null when nothing a watcher
 * cares about changed. `updated_at` always moves and is never interesting on
 * its own.
 */
export function summarizeTomeEntityChange(
  changedKeys: readonly string[],
): TomeEntityChangeSummary | null {
  const keys = changedKeys.filter((key) => key !== "updated_at");
  if (keys.length === 0) return null;
  for (const [prefix, label, category] of CHANGE_SUMMARIES) {
    if (keys.some((key) => key.startsWith(prefix))) return { label, category };
  }
  return { label: "Status change", category: "status_update" };
}

/**
 * Fan a single entity change out to its watchers as an in-app notification.
 *
 * `excludeSubject` keeps an actor from being notified about their own edit.
 * `eventKey` must be unique per change — `createInAppNotification` upserts on
 * it, so a repeated key silently collapses into the existing notification
 * instead of producing a duplicate.
 */
export async function notifyEntityWatchers(input: {
  entitySlug: string;
  entityTitle: string;
  summary: TomeEntityChangeSummary;
  /** Who made the change, shown as the notification's supporting detail. */
  actorLabel?: string;
  eventKey: string;
  href?: string;
  severity?: InAppNotificationSeverity;
  excludeSubject?: string;
}): Promise<number> {
  const subjects = (await listEntityWatcherSubjects(input.entitySlug)).filter(
    (subject) => subject !== input.excludeSubject,
  );
  if (subjects.length === 0) return 0;

  const href =
    input.href ?? `/projects/${encodeURIComponent(input.entitySlug)}/tome`;
  await createInAppNotification({
    eventKey: input.eventKey,
    recipientUserSubjects: subjects,
    title: input.summary.label,
    action: "updated",
    message: input.actorLabel
      ? `Updated by ${input.actorLabel}`
      : "Updated in Tome",
    href,
    severity: input.severity ?? "info",
    category: input.summary.category,
    sourceLabel: "Watching",
    entitySlug: input.entitySlug,
    entityTitle: input.entityTitle,
  });

  // Webex is a second copy of a notification that has already been recorded,
  // so it is awaited but never allowed to throw: the change is notified
  // either way, and the caller is usually a save.
  try {
    await deliverImmediateWebex({
      entitySlug: input.entitySlug,
      entityTitle: input.entityTitle,
      headline: input.summary.label,
      ...(input.actorLabel ? { actorLabel: input.actorLabel } : {}),
      href,
      subjects,
    });
  } catch {
    // Delivery is best-effort; the inbox still has it.
  }
  return subjects.length;
}
