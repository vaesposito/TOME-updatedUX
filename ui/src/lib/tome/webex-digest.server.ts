/**
 * Building and sending the scheduled Webex digests.
 *
 * A digest answers "what did I miss in this project" once, at a time the
 * reader chose, instead of interrupting them per change. It therefore covers
 * what is still unread: anything they already opened in the app has been
 * seen, and repeating it would train them to ignore the message.
 *
 * Drained by a scheduler of its own rather than riding on the auto-ingest
 * tick. Sharing that one would have tied a reader's digest to whether the
 * deployment happens to run scheduled ingests, which has nothing to do with
 * it: their rule would save cleanly and then never fire.
 *
 * Server-only.
 */

import { notificationAudienceQuery } from "@/lib/in-app-notifications.server";
import { getCollection } from "@/lib/mongodb";
import { configuredPublicOrigin } from "@/lib/tome/public-origin";
import {
  claimDueWebexDigest,
  completeWebexDigest,
  type DueWebexDigest,
} from "@/lib/tome/webex-delivery.server";
import {
  deliveryAddress,
  sendWebexMessage,
} from "@/lib/tome/webex-notifier.server";
import type { InAppNotificationDocument } from "@/types/in-app-notification";

const NOTIFICATION_COLLECTION = "in_app_notifications";

/**
 * How long a replica holds a claimed digest.
 *
 * Long enough to cover a slow Webex call, short enough that a replica killed
 * mid-send does not delay the digest past the point of being useful.
 */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

/** Entries listed in full before the message switches to a count. */
const MAX_ENTRIES = 15;

/**
 * Digests sent per tick.
 *
 * A ceiling rather than draining the queue: a tick that tried to clear
 * everything would hold the loop open across hundreds of Webex calls, and
 * the rows it did not reach stay claimable for the next one a minute later.
 */
const MAX_PER_TICK = 25;

/** The window a first-ever digest covers, by cadence. */
const FIRST_WINDOW_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

interface DigestEntry {
  title: string;
  actor?: string;
  href?: string;
  needsAttention: boolean;
}

/**
 * What this reader has not yet seen in this entity.
 *
 * Scoped by the same audience query the inbox uses, so a digest can only
 * ever contain rows that were addressed to this reader in the first place.
 * The watch row is a routing choice and is never treated as a grant: if
 * access was withdrawn, the notification is no longer addressed to them and
 * so cannot appear here.
 */
export async function collectDigestEntries(input: {
  subject: string;
  entitySlug: string;
  since: Date;
}): Promise<DigestEntry[]> {
  const collection = await getCollection<InAppNotificationDocument>(
    NOTIFICATION_COLLECTION,
  );
  const rows = await collection
    .find({
      $and: [
        await notificationAudienceQuery(input.subject),
        { entity_slug: input.entitySlug },
        { created_at: { $gte: input.since.toISOString() } },
        { read_by_subjects: { $ne: input.subject } },
        { dismissed_by_subjects: { $ne: input.subject } },
      ],
    } as never)
    .sort({ created_at: -1 })
    .limit(200)
    .toArray();

  return rows.map((row) => ({
    title: row.title,
    ...(row.actor_name ? { actor: row.actor_name } : {}),
    ...(row.href ? { href: row.href } : {}),
    needsAttention: row.needs_attention === true,
  }));
}

/**
 * The message, or null when there is nothing to say.
 *
 * Returning null rather than an empty digest is deliberate: a weekly message
 * that reliably says "nothing happened" is the fastest way to teach someone
 * to filter the sender.
 *
 * Links are absolute or absent. A relative path is not clickable in Webex,
 * and a half-written link is worse than a plain title.
 */
export function buildDigestMarkdown(input: {
  entityTitle: string;
  entityHref: string;
  entries: readonly DigestEntry[];
  origin: string | null;
}): string | null {
  if (input.entries.length === 0) return null;
  const { origin } = input;
  const link = (href: string, label: string) =>
    origin ? `[${label}](${origin}${href})` : label;

  const total = input.entries.length;
  const attention = input.entries.filter((entry) => entry.needsAttention).length;

  const heading = `**${input.entityTitle}** — ${total} unread update${
    total === 1 ? "" : "s"
  }${attention > 0 ? `, ${attention} needing attention` : ""}`;

  const lines = input.entries.slice(0, MAX_ENTRIES).map((entry) => {
    // The marker goes first so the ones to act on are findable by scanning
    // the left edge, the way they are in the inbox.
    const mark = entry.needsAttention ? "⚠️ " : "";
    const title = entry.href ? link(entry.href, entry.title) : entry.title;
    return `- ${mark}${title}${entry.actor ? ` · By ${entry.actor}` : ""}`;
  });

  const hidden = total - lines.length;
  const footer = [
    ...(hidden > 0 ? [`…and ${hidden} more.`] : []),
    // The same words the pane itself carries, so the link lands somewhere
    // the reader recognises from having been sent there.
    link(input.entityHref, "See what's new"),
  ].join(" ");

  return [heading, "", ...lines, "", footer].join("\n");
}

/** When this rule's window starts: the last digest, or a first-run window. */
function windowStart(digest: DueWebexDigest, now: Date): Date {
  const last = digest.delivery.last_run_at;
  if (last) {
    const parsed = new Date(last);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(
    now.getTime() - (FIRST_WINDOW_MS[digest.delivery.cadence] ?? FIRST_WINDOW_MS.daily),
  );
}

/**
 * Send one claimed digest.
 *
 * Marked complete whether or not anything went out. An empty window and a
 * failed send are both finished cycles as far as scheduling goes — retrying
 * a failure on the next tick would mean a reader whose space the bot was
 * removed from gets retried every minute until someone notices.
 */
async function deliver(digest: DueWebexDigest, now: Date): Promise<boolean> {
  const address = deliveryAddress({
    destination: digest.delivery.destination,
    ...(digest.delivery.space_id ? { spaceId: digest.delivery.space_id } : {}),
    ...(digest.email ? { email: digest.email } : {}),
  });
  if (!address) {
    await completeWebexDigest({
      watcherId: digest.watcherId,
      delivery: digest.delivery,
      sentAt: now,
    });
    return false;
  }

  const entries = await collectDigestEntries({
    subject: digest.subject,
    entitySlug: digest.entitySlug,
    since: windowStart(digest, now),
  });
  const titles = await getCollection<{ slug: string; title?: string }>("projects");
  const entity = await titles.findOne({ slug: digest.entitySlug });

  const markdown = buildDigestMarkdown({
    entityTitle: entity?.title || digest.entitySlug,
    entityHref: `/projects/${encodeURIComponent(digest.entitySlug)}/tome?pane=summary`,
    entries,
    origin: configuredPublicOrigin(),
  });

  const sent = markdown
    ? await sendWebexMessage({ to: address, markdown })
    : false;
  await completeWebexDigest({
    watcherId: digest.watcherId,
    delivery: digest.delivery,
    sentAt: now,
  });
  return sent;
}

/**
 * Send every digest that has come due, up to this tick's ceiling.
 *
 * Returns how many messages actually went out, which is what the caller logs.
 */
export async function tickWebexDigests(now: Date): Promise<number> {
  let sent = 0;
  for (let taken = 0; taken < MAX_PER_TICK; taken += 1) {
    const digest = await claimDueWebexDigest(now, CLAIM_LEASE_MS);
    if (!digest) break;
    try {
      if (await deliver(digest, now)) sent += 1;
    } catch {
      // One reader's digest failing must not strand the rest of the queue.
      // The claim expires on its own, so the row is retried next cycle.
    }
  }
  return sent;
}

const TICK_INTERVAL_MS =
  Number(process.env.TOME_WEBEX_DIGEST_TICK_MS) || 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Whether to drain digests at all.
 *
 * On unless explicitly switched off, unlike the other Tome schedulers. The
 * others act on their own initiative and so are opt-in; this one only ever
 * sends what a reader has already asked for by name, and a hidden flag
 * defaulting to off would make that request silently do nothing.
 */
function isEnabled(): boolean {
  return process.env.TOME_WEBEX_DIGEST_ENABLED !== "false";
}

/** Start the once-a-minute digest drain. Idempotent. */
export function startWebexDigestScheduler(): void {
  if (timer) return;
  if (!isEnabled()) {
    console.log("[WebexDigest] disabled (TOME_WEBEX_DIGEST_ENABLED=false)");
    return;
  }
  // A tick that overruns must not be re-entered: claims are leased, so a
  // second pass would skip the row it is already working on and the loop
  // would do nothing useful while doubling the load.
  let running = false;
  const runTick = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await tickWebexDigests(new Date());
      if (sent > 0) console.log(`[WebexDigest] sent ${sent} digest(s)`);
    } catch (err) {
      console.error(
        "[WebexDigest] tick failed: " +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void runTick(), TICK_INTERVAL_MS);
  // Never hold the process open for a digest.
  timer.unref?.();
  console.log(`[WebexDigest] scheduler started (tick every ${TICK_INTERVAL_MS}ms)`);
}

export function stopWebexDigestScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
