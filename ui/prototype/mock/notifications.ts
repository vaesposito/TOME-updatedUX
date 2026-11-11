/**
 * What has happened lately, in the shapes the bell and the digests read.
 *
 * One store of events, three readings of it: the bell lists the latest of
 * them, a space's Home shows the ones belonging to that space grouped by what
 * a reader would do about them, and the follow tree says where they came
 * from. Deriving all three from one list is what keeps them agreeing with
 * each other — a prototype whose counts contradict its rows is worse than no
 * prototype.
 */

import type {
  InAppNotificationView,
  NotificationFollowTree,
  NotificationFollowTreeNode,
} from "@/types/in-app-notification";
import type {
  TomeSummary,
  TomeSummaryItem,
  TomeSummarySectionKey,
} from "@/types/tome-summary";

import { PARENT_OF, SPACES, spaceBySlug, USER } from "./data";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

interface EventSeed {
  id: string;
  title: string;
  message: string;
  entity: string;
  days: number;
  category: InAppNotificationView["category"];
  severity?: InAppNotificationView["severity"];
  action?: "new" | "updated";
  event_label?: string;
  reference?: string;
  actor?: string;
  attention?: boolean;
  mentioned?: boolean;
  read?: boolean;
  resolved?: boolean;
}

const EVENTS: EventSeed[] = [
  {
    id: "ev-mention",
    title: "Jordan Bell tagged you on What goes into a cache key",
    message:
      "Worth saying here that vendored dependencies are the open question — can you take it?",
    entity: "build-pipeline",
    days: 0.3,
    category: "decision",
    action: "updated",
    event_label: "You were tagged",
    reference: "decisions/cache-key.md",
    actor: "Jordan Bell",
    attention: true,
    mentioned: true,
  },
  {
    id: "ev-overview",
    title: "Overview was rewritten after an ingest",
    message:
      "The cache now answers about two thirds of all steps; median build time is down to four minutes.",
    entity: "build-pipeline",
    days: 0.5,
    category: "status_update",
    action: "updated",
    event_label: "Rewritten by the agent",
    reference: "overview.md",
    actor: "TOME",
  },
  {
    id: "ev-decision",
    title: "Cache keys will not include the branch",
    message:
      "Agreed in the pipeline standup: the key is the lockfile, the toolchain and the build inputs.",
    entity: "build-pipeline",
    days: 1.2,
    category: "decision",
    severity: "success",
    action: "new",
    event_label: "Decided",
    reference: "decisions/cache-key.md",
    actor: "Avery Quinn",
    resolved: true,
  },
  {
    id: "ev-risk",
    title: "Vendored dependencies are not reproducible across runners",
    message: "Raised in the standup and still without an owner after a week.",
    entity: "build-pipeline",
    days: 3,
    category: "risk",
    severity: "warning",
    action: "new",
    event_label: "Open 3 days",
    reference: "decisions/cache-key.md",
    attention: true,
  },
  {
    id: "ev-due",
    title: "Size-based cache eviction is due on Friday",
    message: "The last thing between the pipeline and more repositories.",
    entity: "build-pipeline",
    days: 2,
    category: "due",
    severity: "warning",
    action: "updated",
    event_label: "Due in 3 days",
    reference: "roadmap.md",
    attention: true,
  },
  {
    id: "ev-ingest",
    title: "Ingest finished for Environment fleet",
    message: "Four pages rewritten and one new page drafted for review.",
    entity: "environment-fleet",
    days: 2.1,
    category: "status_update",
    action: "updated",
    event_label: "Ingest finished",
    actor: "TOME",
    read: true,
  },
  {
    id: "ev-roadmap",
    title: "Preview environments moved ahead of per-service budgets",
    message: "The fleet's roadmap was reordered after the capacity review.",
    entity: "environment-fleet",
    days: 4,
    category: "roadmap_change",
    action: "updated",
    event_label: "Roadmap changed",
    reference: "roadmap.md",
    actor: "Sam Okafor",
    read: true,
  },
  {
    id: "ev-access",
    title: "Rowan Imani recorded this quarter's access exceptions",
    message: "Three exceptions, each with an expiry and a named approver.",
    entity: "access-reviews",
    days: 4.4,
    category: "status_update",
    action: "updated",
    event_label: "Edited",
    reference: "overview.md",
    actor: "Rowan Imani",
    read: true,
  },
  {
    id: "ev-oncall",
    title: "The on-call handover moved to Tuesday mornings",
    message: "So that the person coming off call is not the one writing it up.",
    entity: "on-call-rota",
    days: 5,
    category: "decision",
    severity: "success",
    action: "new",
    event_label: "Decided",
    actor: "Jordan Bell",
    read: true,
    resolved: true,
  },
  {
    id: "ev-dependency",
    title: "Two packages left the allowed list",
    message:
      "Both unmaintained for more than a year; nothing in the fleet still imports them.",
    entity: "dependency-policy",
    days: 6,
    category: "dependency",
    action: "updated",
    event_label: "Policy changed",
    actor: "Rowan Imani",
    read: true,
  },
  {
    id: "ev-review",
    title: "Review practice now asks for a reason, not an approval",
    message:
      "Reviewers are asked to say what they checked, so the tools can own the rest.",
    entity: "review-practice",
    days: 6.5,
    category: "general",
    action: "updated",
    event_label: "Edited",
    actor: "Avery Quinn",
    read: true,
  },
  {
    id: "ev-platform",
    title: "Ingest workers were restarted",
    message: "A rolling restart after the scheduler upgrade. No runs were lost.",
    entity: "",
    days: 1.5,
    category: "platform_health",
    severity: "info",
    action: "updated",
    event_label: "Platform",
    actor: "Platform",
  },
];

function view(seed: EventSeed): InAppNotificationView {
  const space = seed.entity ? spaceBySlug(seed.entity) : undefined;
  return {
    id: seed.id,
    title: seed.title,
    message: seed.message,
    href: space
      ? seed.reference
        ? `/projects/${space.slug}/tome/wiki/${seed.reference}`
        : `/projects/${space.slug}/tome`
      : undefined,
    severity: seed.severity ?? "info",
    category: seed.category,
    action: seed.action ?? "updated",
    source_label: seed.category === "platform_health" ? "Platform" : "TOME",
    lifecycle_status: seed.resolved ? "resolved" : "active",
    resolved_at: seed.resolved ? ago(seed.days) : undefined,
    created_at: ago(seed.days),
    read: seed.read ?? false,
    entity_slug: space?.slug,
    entity_title: space?.title,
    event_label: seed.event_label,
    reference: seed.reference,
    actor_name: seed.actor,
    needs_attention: seed.attention ?? false,
    mentioned: seed.mentioned ?? false,
    dismissed: false,
    following: space ? FOLLOWED.has(space.slug) : false,
  };
}

/** What this reader follows to begin with. */
export const FOLLOWED = new Set([
  "ship-weekly",
  "delivery-platform",
  "build-pipeline",
  "incident-response",
]);

export const ROWS: InAppNotificationView[] = EVENTS.map(view);

export function rowsFor(slugs: readonly string[]): InAppNotificationView[] {
  const wanted = new Set(slugs);
  return ROWS.filter((row) => row.entity_slug && wanted.has(row.entity_slug));
}

/**
 * The follow tree: every readable space, flat and depth-first, with the pages
 * this reader already follows hung under their space.
 */
export function followTree(following: ReadonlySet<string>): NotificationFollowTree {
  const nodes: NotificationFollowTreeNode[] = [];
  const unreadOf = (slug: string) =>
    ROWS.filter((row) => row.entity_slug === slug && !row.read).length;
  const subtreeOf = (slug: string): number => {
    const below = SPACES.filter((space) => PARENT_OF[space.slug] === slug);
    return unreadOf(slug) + below.reduce((sum, space) => sum + subtreeOf(space.slug), 0);
  };

  const walk = (parent: string | undefined) => {
    for (const space of SPACES) {
      if (PARENT_OF[space.slug] !== parent) continue;
      nodes.push({
        slug: space.slug,
        title: space.title,
        type: (space.type === "subject" ? "project" : space.type) as
          | "bhag"
          | "area"
          | "project",
        ...(parent ? { parent_slug: parent } : {}),
        entity_slug: space.slug,
        following: following.has(space.slug),
        muted: false,
        unread: unreadOf(space.slug),
        subtree_unread: subtreeOf(space.slug),
      });
      walk(space.slug);
    }
  };
  walk(undefined);

  return { nodes, total_unread: ROWS.filter((row) => !row.read).length };
}

/** Which bucket of a space's digest a row belongs in. */
function sectionOf(row: InAppNotificationView): TomeSummarySectionKey {
  if (row.needs_attention) return "attention";
  if (row.category === "decision") {
    return row.lifecycle_status === "resolved" ? "decided" : "open_decisions";
  }
  if (row.actor_name && row.actor_name !== "TOME") return "team";
  return "wiki";
}

const SECTIONS: {
  key: TomeSummarySectionKey;
  title: string;
  description: string;
}[] = [
  {
    key: "attention",
    title: "Needs attention",
    description: "Waiting on somebody here.",
  },
  { key: "decided", title: "Decided", description: "Settled, and worth knowing." },
  {
    key: "open_decisions",
    title: "Open decisions",
    description: "Asked, and not yet answered.",
  },
  { key: "team", title: "From the team", description: "What people changed." },
  {
    key: "elsewhere",
    title: "Elsewhere",
    description: "From spaces that touch this one.",
  },
  { key: "wiki", title: "The wiki", description: "What the agent rewrote." },
];

function item(row: InAppNotificationView): TomeSummaryItem {
  const space = row.entity_slug ? spaceBySlug(row.entity_slug) : undefined;
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    href: row.href,
    category: row.category,
    severity: row.severity,
    event_label: row.event_label ?? "",
    action: row.action,
    entity_slug: row.entity_slug ?? "",
    entity_title: row.entity_title ?? "",
    entity_type: (space?.type ?? "project") as TomeSummaryItem["entity_type"],
    reference: row.reference,
    actor_name: row.actor_name,
    created_at: row.created_at,
    open_days: Math.max(
      0,
      Math.floor((Date.now() - Date.parse(row.created_at)) / DAY),
    ),
    read: row.read,
    needs_attention: row.needs_attention,
    resolved: row.lifecycle_status === "resolved",
    reason: row.mentioned
      ? "mentioned"
      : FOLLOWED.has(row.entity_slug ?? "")
        ? "watching"
        : "in_scope",
    following: row.following,
  };
}

/** Everything at or below a space, which is what "all of this" covers. */
export function subtreeOf(slug: string): string[] {
  const below = SPACES.filter((space) => PARENT_OF[space.slug] === slug);
  return [slug, ...below.flatMap((space) => subtreeOf(space.slug))];
}

/**
 * One space's digest, as its Home reads it.
 *
 * `scope` is honoured: For me keeps the rows this reader is actually in the
 * audience for, which is the difference the toggle on the card exists to show.
 */
export function summaryFor(slug: string, scope: "for_me" | "all"): TomeSummary {
  const space = spaceBySlug(slug);
  const slugs = slug ? subtreeOf(slug) : SPACES.map((s) => s.slug);
  let rows = rowsFor(slugs);
  if (scope === "for_me") {
    rows = rows.filter((row) => row.mentioned || FOLLOWED.has(row.entity_slug ?? ""));
  }

  const sections = SECTIONS.map((section) => {
    const items = rows.filter((row) => sectionOf(row) === section.key).map(item);
    return { ...section, items, total: items.length };
  }).filter((section) => section.items.length > 0);

  const attention = rows.filter((row) => row.needs_attention).length;
  const entity = {
    slug,
    title: space?.title ?? "TOME",
    type: (space?.type ?? "bhag") as TomeSummary["entity"]["type"],
    ...(PARENT_OF[slug] ? { parent_slug: PARENT_OF[slug] as string } : {}),
  };

  return {
    entity,
    scope_entities: slugs.map((each) => {
      const found = spaceBySlug(each);
      return {
        slug: each,
        title: found?.title ?? each,
        type: (found?.type ?? "project") as TomeSummary["entity"]["type"],
        ...(PARENT_OF[each] ? { parent_slug: PARENT_OF[each] as string } : {}),
        attention: rowsFor([each]).filter((row) => row.needs_attention).length,
        unread: rowsFor([each]).filter((row) => !row.read).length,
        latest_at: rowsFor([each])[0]?.created_at,
      };
    }),
    scope,
    headline: attention
      ? `${attention} ${attention === 1 ? "item needs" : "items need"} attention in ${entity.title}`
      : `Nothing is waiting on anyone in ${entity.title}`,
    counts: {
      attention,
      decided: rows.filter((row) => sectionOf(row) === "decided").length,
      open_decisions: rows.filter((row) => sectionOf(row) === "open_decisions").length,
      team: rows.filter((row) => sectionOf(row) === "team").length,
      elsewhere: 0,
      wiki: rows.filter((row) => sectionOf(row) === "wiki").length,
      descendants: Math.max(0, slugs.length - 1),
      recently_resolved: rows.filter((row) => row.lifecycle_status === "resolved").length,
      unread: rows.filter((row) => !row.read).length,
    },
    sections,
    since: ago(7),
    generated_at: new Date().toISOString(),
  };
}

export const WHO = USER;
