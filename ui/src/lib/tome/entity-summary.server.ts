import { getCollection } from "@/lib/mongodb";
import { notificationAudienceQuery } from "@/lib/in-app-notifications.server";
import {
  getNotificationPreferences,
  preferenceClauses,
} from "@/lib/notification-preferences.server";
import { resolveEntitySubtree } from "@/lib/tome/entity-hierarchy";
import { listSubjectWatchedEntities } from "@/lib/tome/watchers";
import type { InAppNotificationDocument } from "@/types/in-app-notification";
import type { ProjectDocument } from "@/types/projects";
import {
  type TomeSummary,
  type TomeSummaryCounts,
  type TomeSummaryItem,
  type TomeSummaryReason,
  type TomeSummaryScope,
  type TomeSummarySection,
  type TomeSummarySectionKey,
} from "@/types/tome-summary";

/** Rows rendered per section before the reader is pointed at the full inbox. */
const PER_SECTION = 5;

/** How far back the "since" strip and the Decided section look. */
const WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SummaryPrincipal {
  subject: string;
  email: string;
  /** Teams the reader belongs to, used to explain why a row is theirs. */
  teamSlugs?: readonly string[];
}

/**
 * Entities one step outside the scope that sit alongside it — other Areas
 * under the same BHAG, or sibling Projects in the same Area.
 *
 * This is what the summary means by "elsewhere": work that is adjacent rather
 * than unrelated. It is derived from the hierarchy rather than from any
 * declared dependency, because the entity model has no cross-links.
 */
async function resolveAdjacentSlugs(
  entity: Pick<ProjectDocument, "slug" | "type" | "labels">,
  scopeSlugs: ReadonlySet<string>,
): Promise<string[]> {
  const parents = [
    ...(entity.labels?.areas ?? []),
    ...(entity.labels?.initiatives ?? []),
  ].filter(Boolean);
  if (parents.length === 0) return [];

  const projects = await getCollection<ProjectDocument>("projects");
  const siblings = await projects
    .find({
      $or: [
        { "labels.areas": { $in: parents } },
        { "labels.initiatives": { $in: parents } },
      ],
    })
    .project<{ slug: string }>({ slug: 1 })
    .toArray();
  return siblings
    .map((sibling) => sibling.slug)
    .filter((slug) => slug && !scopeSlugs.has(slug));
}

/**
 * Rows addressed to no one by name.
 *
 * Team and platform-wide announcements qualify; a tag or a personal note
 * does not. The test is on the mention list rather than the recipient list
 * because a watcher notification names subjects purely to deliver it, while
 * a mention is the sender choosing a person.
 */
const IMPERSONAL = {
  $or: [{ mention_subjects: { $exists: false } }, { mention_subjects: { $size: 0 } }],
};

function openDays(createdAt: string): number {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / DAY_MS)) : 0;
}

/**
 * Why this row reached the reader, strongest claim first: being named beats
 * being addressed, which beats having chosen to follow, which beats simply
 * being in the part of the org they opened.
 */
function reasonFor(
  row: InAppNotificationDocument,
  principal: SummaryPrincipal,
  watched: ReadonlySet<string>,
  inScope: boolean,
): TomeSummaryReason {
  if ((row.mention_subjects ?? []).includes(principal.subject)) return "mentioned";
  if ((row.recipient_user_subjects ?? []).includes(principal.subject)) return "addressed";
  if (row.entity_slug && watched.has(row.entity_slug)) return "watching";
  return inScope ? "in_scope" : "adjacent";
}

/** The reader's own items, as opposed to everything happening in the scope. */
function isPersonal(reason: TomeSummaryReason): boolean {
  return reason === "mentioned" || reason === "addressed" || reason === "watching";
}

const WIKI_CATEGORIES = new Set(["collateral"]);

/**
 * Which section a row belongs in. Order matters: a decision that needs
 * attention is an action, not a record, so attention wins over category.
 */
function sectionFor(
  row: InAppNotificationDocument,
  inScope: boolean,
): TomeSummarySectionKey {
  const resolved = row.lifecycle_status === "resolved";
  if (!inScope) return "elsewhere";
  if (!resolved && (row.needs_attention === true || row.severity === "error")) {
    return "attention";
  }
  if (row.category === "decision") return resolved ? "decided" : "open_decisions";
  if (resolved) return "decided";
  // Wiki edits are collateral, but they are housekeeping rather than news and
  // the mock gives them their own section at the bottom.
  if (WIKI_CATEGORIES.has(row.category ?? "") && row.source_label === "Wiki") {
    return "wiki";
  }
  return "team";
}

const SECTION_META: Record<
  TomeSummarySectionKey,
  { title: string; description: string }
> = {
  attention: {
    title: "Open and needing attention",
    description: "Critical first. Each item says why you're seeing it.",
  },
  decided: {
    title: "Decided",
    description: "What was settled, and where it was settled.",
  },
  open_decisions: {
    title: "Still open",
    description: "Decisions waiting on someone.",
  },
  team: {
    title: "New from teams",
    description: "Demos, status updates and collateral.",
  },
  elsewhere: {
    title: "Elsewhere in the org",
    description: "Open items from alongside this work.",
  },
  wiki: {
    title: "Wiki changes",
    description: "Edits to roadmaps, charters and other human-owned pages.",
  },
};

const SECTION_ORDER: TomeSummarySectionKey[] = [
  "attention",
  "decided",
  "open_decisions",
  "team",
  "elsewhere",
  "wiki",
];

const NUMBER_WORDS = [
  "No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
];

function spell(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/**
 * The one line a reader should be able to act on without scrolling. It leads
 * with attention because that is the only bucket that asks something of them.
 */
function headlineFor(counts: TomeSummaryCounts, entityTitle: string): string {
  if (counts.attention > 0) {
    const noun = counts.attention === 1 ? "item needs" : "items need";
    return `${spell(counts.attention)} ${noun} attention in ${entityTitle}`;
  }
  if (counts.open_decisions > 0) {
    const noun = counts.open_decisions === 1 ? "decision is" : "decisions are";
    return `${spell(counts.open_decisions)} ${noun} waiting in ${entityTitle}`;
  }
  const activity = counts.team + counts.decided + counts.wiki;
  if (activity > 0) {
    return `${spell(activity)} ${activity === 1 ? "update" : "updates"} in ${entityTitle}`;
  }
  return `Nothing needs attention in ${entityTitle}`;
}

export async function getEntitySummary(input: {
  entity: Pick<ProjectDocument, "slug" | "title" | "type" | "labels">;
  principal: SummaryPrincipal;
  scope?: TomeSummaryScope;
}): Promise<TomeSummary> {
  const scope: TomeSummaryScope = input.scope === "for_me" ? "for_me" : "all";
  const scopeEntities = await resolveEntitySubtree(input.entity);
  const scopeSlugs = new Set(scopeEntities.map((entry) => entry.slug));
  const [adjacentSlugs, watchedEntities, prefs] = await Promise.all([
    resolveAdjacentSlugs(input.entity, scopeSlugs),
    listSubjectWatchedEntities(input.principal.subject),
    getNotificationPreferences(input.principal.email),
  ]);
  const watched = new Set(watchedEntities.map((entry) => entry.entity_slug));

  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();
  const collection = await getCollection<InAppNotificationDocument>(
    "in_app_notifications",
  );
  // A summary describes a space, so it must not be empty for someone who can
  // open the space but has not subscribed to it. Two things may appear: what
  // the reader would have received anyway, and activity addressed to nobody
  // in particular. Anything carrying a mention is somebody's message and
  // stays out unless the reader is already in its audience, so opening a
  // project never becomes a way to read what was said to another person.
  // The entity read check in the route is what permits the second half.
  const rows = await collection
    .find({
      $and: [
        {
          $or: [
            await notificationAudienceQuery(input.principal.subject),
            IMPERSONAL,
          ],
        },
        ...preferenceClauses(prefs),
        { dismissed_by_subjects: { $ne: input.principal.subject } },
        { entity_slug: { $in: [...scopeSlugs, ...adjacentSlugs] } },
      ],
    } as never)
    .sort({ created_at: -1, _id: -1 })
    .limit(400)
    .toArray();

  const titleBySlug = new Map(
    scopeEntities.map((entry) => [entry.slug, entry] as const),
  );
  const buckets = new Map<TomeSummarySectionKey, TomeSummaryItem[]>(
    SECTION_ORDER.map((key) => [key, []]),
  );
  let recentlyResolved = 0;
  let unread = 0;

  for (const row of rows) {
    const inScope = Boolean(row.entity_slug && scopeSlugs.has(row.entity_slug));
    const reason = reasonFor(row, input.principal, watched, inScope);
    if (scope === "for_me" && !isPersonal(reason)) continue;

    const resolved = row.lifecycle_status === "resolved";
    const read = row.read_by_subjects.includes(input.principal.subject);
    if (!read) unread += 1;
    if (resolved && (row.resolved_at ?? row.created_at) >= since) {
      recentlyResolved += 1;
    }
    // Decided is a record of what happened lately, not a permanent archive;
    // older settled items would crowd out everything still in motion.
    const key = sectionFor(row, inScope);
    if (key === "decided" && (row.resolved_at ?? row.created_at) < since) continue;

    const known = titleBySlug.get(row.entity_slug ?? "");
    buckets.get(key)?.push({
      id: row._id,
      title: row.title,
      message: row.message,
      ...(row.href ? { href: row.href } : {}),
      category: row.category ?? "general",
      severity: row.severity,
      event_label: row.event_label ?? row.source_label ?? "Update",
      ...(row.action ? { action: row.action } : {}),
      entity_slug: row.entity_slug ?? input.entity.slug,
      entity_title: known?.title ?? row.entity_title ?? row.entity_slug ?? "",
      entity_type: known?.type ?? "project",
      ...(row.reference ? { reference: row.reference } : {}),
      ...(row.actor_name ? { actor_name: row.actor_name } : {}),
      created_at: row.created_at,
      open_days: openDays(row.created_at),
      read,
      needs_attention: row.needs_attention === true,
      resolved,
      reason,
      following: Boolean(row.entity_slug && watched.has(row.entity_slug)),
    });
  }

  // Oldest first where something is waiting on a person — an item open for 36
  // days is more urgent than one raised this morning. Everywhere else the
  // newest is the news.
  const oldestFirst = new Set<TomeSummarySectionKey>([
    "attention",
    "open_decisions",
    "elsewhere",
  ]);
  for (const [key, items] of buckets) {
    items.sort((a, b) =>
      oldestFirst.has(key)
        ? a.created_at.localeCompare(b.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
  }

  const counts: TomeSummaryCounts = {
    attention: buckets.get("attention")?.length ?? 0,
    decided: buckets.get("decided")?.length ?? 0,
    open_decisions: buckets.get("open_decisions")?.length ?? 0,
    team: buckets.get("team")?.length ?? 0,
    elsewhere: buckets.get("elsewhere")?.length ?? 0,
    wiki: buckets.get("wiki")?.length ?? 0,
    descendants: scopeEntities.length - 1,
    recently_resolved: recentlyResolved,
    unread,
  };

  const sections: TomeSummarySection[] = SECTION_ORDER.map((key) => {
    const items = buckets.get(key) ?? [];
    return {
      key,
      title: SECTION_META[key].title,
      description: SECTION_META[key].description,
      items: items.slice(0, PER_SECTION),
      total: items.length,
    };
  }).filter((section) => section.total > 0);

  return {
    entity: {
      slug: input.entity.slug,
      title: input.entity.title,
      type: input.entity.type ?? "project",
    },
    scope_entities: scopeEntities,
    scope,
    headline: headlineFor(counts, input.entity.title),
    counts,
    sections,
    since,
    generated_at: new Date().toISOString(),
  };
}
