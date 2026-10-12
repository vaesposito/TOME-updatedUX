/**
 * Reading and writing each reader's Webex delivery rules.
 *
 * A rule lives on the watch it belongs to (see `TomeWatcherWebexDelivery`),
 * so this module is mostly a typed view over `tome_watchers` plus the one
 * piece of real logic: working out when a digest is next due, in the
 * reader's own timezone rather than the server's.
 *
 * Server-only.
 */

import { getCollection } from "@/lib/mongodb";
import {
  WATCHER_COLLECTION,
  type TomeWatcherDocument,
  type TomeWatcherWebexDelivery,
} from "@/lib/tome/watchers";
import {
  DEFAULT_WEBEX_DELIVERY_HOUR,
  DEFAULT_WEBEX_DELIVERY_WEEKDAY,
  type WebexDeliveryCadence,
  type WebexDeliveryDestination,
  type WebexDeliveryRule,
} from "@/types/webex-delivery";

/** Matches entity-level rows only; pages have no delivery rule of their own. */
const ENTITY_ONLY = { page_path: { $exists: false } } as const;

const MINUTE_MS = 60 * 1000;

/**
 * How far ahead to look for the next digest slot.
 *
 * A week plus a day for weekly, so that a rule set just after its own slot
 * finds next week's rather than giving up. Two days for daily, for the same
 * reason.
 */
const SEARCH_MINUTES: Record<"daily" | "weekly", number> = {
  daily: 2 * 24 * 60,
  weekly: 8 * 24 * 60,
};

/**
 * Step size when walking forward for a digest slot.
 *
 * Fifteen minutes because not every zone is a whole hour from UTC — India is
 * +5:30 and Nepal +5:45 — so stepping by the hour would never land on a
 * local minute zero for readers there.
 */
const STEP_MINUTES = 15;

async function watchers() {
  return getCollection<TomeWatcherDocument>(WATCHER_COLLECTION);
}

/**
 * Whether a string is a timezone this runtime can actually resolve.
 *
 * The zone arrives from the browser and is used to schedule sends, so an
 * unknown one has to be rejected at the edge: `Intl` throws on it, and a
 * throw inside the scheduler tick would stop every other reader's digest.
 */
export function isValidTimezone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The wall-clock hour, minute and weekday an instant reads as in `zone`. */
function zonedParts(
  instant: Date,
  zone: string,
): { hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    hour: Number.parseInt(value("hour"), 10),
    minute: Number.parseInt(value("minute"), 10),
    weekday: WEEKDAY_INDEX[value("weekday")] ?? 0,
  };
}

/**
 * When this rule's next digest is due, or undefined if it never is.
 *
 * Found by walking forward from now and asking each candidate instant what
 * time it reads as where the reader is, rather than by arithmetic on an
 * offset. Offsets change twice a year, and a digest promised for 9am has to
 * keep arriving at 9am across the change.
 *
 * A slot a daylight-saving jump skips entirely is simply not found that day,
 * and the walk lands on the next one. Missing a single digest is a better
 * failure than inventing an hour that did not happen.
 */
export function nextDigestRun(
  rule: Pick<WebexDeliveryRule, "cadence" | "hour" | "weekday" | "timezone">,
  now: Date,
): string | undefined {
  if (rule.cadence === "immediate") return undefined;
  if (!isValidTimezone(rule.timezone)) return undefined;

  // Start at the next whole step, so a rule saved at 08:59 for 09:00 still
  // catches today rather than being considered already past.
  const start =
    Math.ceil(now.getTime() / (STEP_MINUTES * MINUTE_MS)) *
    (STEP_MINUTES * MINUTE_MS);
  const steps = SEARCH_MINUTES[rule.cadence] / STEP_MINUTES;

  for (let step = 0; step <= steps; step += 1) {
    const candidate = new Date(start + step * STEP_MINUTES * MINUTE_MS);
    const parts = zonedParts(candidate, rule.timezone);
    if (parts.minute !== 0 || parts.hour !== rule.hour) continue;
    if (rule.cadence === "weekly" && parts.weekday !== rule.weekday) continue;
    return candidate.toISOString();
  }
  return undefined;
}

/** The rule as stored, or the Off default for a watch never configured. */
function toRule(row: TomeWatcherDocument, title: string): WebexDeliveryRule {
  const stored = row.webex_delivery;
  return {
    entity_slug: row.entity_slug,
    entity_title: title,
    entity_type: row.entity_type,
    destination: stored?.destination ?? "off",
    ...(stored?.space_id ? { space_id: stored.space_id } : {}),
    ...(stored?.space_name ? { space_name: stored.space_name } : {}),
    cadence: stored?.cadence ?? "immediate",
    hour: stored?.hour ?? DEFAULT_WEBEX_DELIVERY_HOUR,
    weekday: stored?.weekday ?? DEFAULT_WEBEX_DELIVERY_WEEKDAY,
    timezone: stored?.timezone ?? "UTC",
  };
}

/**
 * Every entity this reader watches, each with its rule.
 *
 * Watched entities with no rule are listed too, set to Off: the tab's job is
 * to show what could be routed as much as what is, and a reader looking for
 * a project they watch should not have to wonder why it is missing.
 *
 * A subscription whose entity has since been deleted is dropped, matching
 * `listSubjectWatchedEntities`.
 */
export async function listWebexDeliveryRules(
  subject: string,
): Promise<WebexDeliveryRule[]> {
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
    .find({ slug: { $in: [...new Set(rows.map((row) => row.entity_slug))] } })
    .project<{ slug: string; title?: string }>({ slug: 1, title: 1 })
    .toArray();
  const titleBySlug = new Map(named.map((row) => [row.slug, row.title]));

  return rows
    .filter((row) => titleBySlug.has(row.entity_slug))
    .map((row) =>
      toRule(row, titleBySlug.get(row.entity_slug) || row.entity_slug),
    );
}

export interface WebexDeliveryRuleInput {
  destination: WebexDeliveryDestination;
  spaceId?: string;
  spaceName?: string;
  cadence: WebexDeliveryCadence;
  hour: number;
  weekday: number;
  timezone: string;
}

/**
 * Write one rule, onto an existing watch.
 *
 * Deliberately not an upsert. A rule is a property of a subscription, so
 * configuring delivery for something the reader does not watch would create
 * a half-subscription that routes mail but shows up nowhere as followed. The
 * caller gets `false` and can say so.
 */
export async function setWebexDeliveryRule(input: {
  subject: string;
  entitySlug: string;
  rule: WebexDeliveryRuleInput;
  now?: Date;
}): Promise<boolean> {
  const { subject, entitySlug, rule } = input;
  if (!subject || !entitySlug) return false;
  const now = input.now ?? new Date();

  const delivery: TomeWatcherWebexDelivery = {
    destination: rule.destination,
    ...(rule.destination === "space" && rule.spaceId
      ? {
          space_id: rule.spaceId,
          ...(rule.spaceName ? { space_name: rule.spaceName } : {}),
        }
      : {}),
    cadence: rule.cadence,
    hour: rule.hour,
    weekday: rule.weekday,
    timezone: rule.timezone,
    updated_at: now.toISOString(),
  };

  // Only a live rule carries a due time. Turning delivery off or back to
  // immediate clears it, so the scheduler stops considering the row at all
  // rather than having to re-check the destination on every tick.
  const due =
    delivery.destination === "off" ? undefined : nextDigestRun(rule, now);
  if (due) delivery.next_run_at = due;

  const result = await (await watchers()).updateOne(
    { entity_slug: entitySlug, subject, ...ENTITY_ONLY },
    { $set: { webex_delivery: delivery } },
  );
  return result.matchedCount > 0;
}

export interface DueWebexDigest {
  watcherId: string;
  subject: string;
  email?: string;
  entitySlug: string;
  entityType: TomeWatcherDocument["entity_type"];
  delivery: TomeWatcherWebexDelivery;
}

/**
 * Claim one due digest, or null when none is.
 *
 * Claimed one at a time by a conditional update: the filter is also the
 * lock, so two replicas ticking together cannot both win the same row and
 * send a reader the same digest twice.
 */
export async function claimDueWebexDigest(
  now: Date,
  leaseMs: number,
): Promise<DueWebexDigest | null> {
  const nowIso = now.toISOString();
  const row = await (await watchers()).findOneAndUpdate(
    {
      ...ENTITY_ONLY,
      "webex_delivery.next_run_at": { $lte: nowIso },
      "webex_delivery.destination": { $in: ["direct", "space"] },
      // Either unclaimed, or a claim that has outlived the replica that took
      // it. The second case is the reaper: no separate sweep is needed.
      $or: [
        { "webex_delivery.claimed_until": { $exists: false } },
        { "webex_delivery.claimed_until": { $lte: nowIso } },
      ],
    } as never,
    {
      $set: {
        "webex_delivery.claimed_until": new Date(
          now.getTime() + leaseMs,
        ).toISOString(),
      },
    } as never,
    { returnDocument: "after" },
  );
  if (!row?.webex_delivery) return null;
  return {
    watcherId: row._id,
    subject: row.subject,
    ...(row.email ? { email: row.email } : {}),
    entitySlug: row.entity_slug,
    entityType: row.entity_type,
    delivery: row.webex_delivery,
  };
}

/**
 * Record that a digest cycle is over and when the next one is due.
 *
 * Called whether or not anything was sent — an empty digest is still a
 * completed cycle, and leaving the due time in the past would make the
 * scheduler retry the same empty window forever.
 */
export async function completeWebexDigest(input: {
  watcherId: string;
  delivery: TomeWatcherWebexDelivery;
  sentAt: Date;
}): Promise<void> {
  const next = nextDigestRun(input.delivery, input.sentAt);
  await (await watchers()).updateOne({ _id: input.watcherId }, {
    $set: {
      "webex_delivery.last_run_at": input.sentAt.toISOString(),
      ...(next ? { "webex_delivery.next_run_at": next } : {}),
    },
    $unset: {
      "webex_delivery.claimed_until": "",
      ...(next ? {} : { "webex_delivery.next_run_at": "" }),
    },
  } as never);
}
