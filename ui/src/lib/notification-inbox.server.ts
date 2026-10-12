/**
 * The notification inbox: the full-page view behind the header bell.
 *
 * Everything here is scoped to one recipient. A notification row is shared by
 * its whole audience, so per-user state (read, dismissed) lives in arrays on
 * the row rather than in copies per person — which is why every query carries
 * the subject rather than filtering on a boolean.
 *
 * Server-only.
 */

import { getCollection } from "@/lib/mongodb";
import { notificationAudienceQuery } from "@/lib/in-app-notifications.server";
import {
  getNotificationPreferences,
  preferenceClauses,
} from "@/lib/notification-preferences.server";
import {
  resolveEntityAncestry,
  resolveEntitySubtree,
  resolveReadableHierarchy,
} from "@/lib/tome/entity-hierarchy";
import { resolveUniqueTomeProjectBySlug } from "@/lib/tome/project-resolver";
import {
  listSubjectWatchedEntities,
  listSubjectWatchedPages,
} from "@/lib/tome/watchers";
import {
  EMPTY_NOTIFICATION_FILTER,
  NEW_FOR_DAYS,
  NOTIFICATION_TYPE_FACETS,
  TOME_NOTIFICATION_CATEGORIES,
  notificationAction,
  type NotificationAction,
  type NotificationOrigin,
  type InAppNotificationDocument,
  type InAppNotificationView,
  type NotificationEntityFacet,
  type NotificationFollowTree,
  type NotificationFollowTreeNode,
  type NotificationInboxFacets,
  type NotificationInboxFilter,
  type NotificationInboxResponse,
  type NotificationInboxTab,
  type NotificationPreferences,
} from "@/types/in-app-notification";

const NOTIFICATION_COLLECTION = "in_app_notifications";

const MAX_PAGE_SIZE = 100;

/**
 * Notification rows address the Keycloak subject, while `user_settings` (and
 * therefore preferences) is keyed by email. Entry points take both rather than
 * resolving one from the other on every call.
 */
export interface InboxPrincipal {
  subject: string;
  email: string;
}

async function notifications() {
  return getCollection<InAppNotificationDocument>(NOTIFICATION_COLLECTION);
}

/**
 * Mongo filter for everything this subject may see, honouring their
 * preferences. Muted entities and (optionally) Tome categories drop out here
 * so that facet counts and the listing can never disagree about the universe.
 */
async function visibleQuery(
  subject: string,
  prefs: NotificationPreferences,
): Promise<Record<string, unknown>> {
  const audience = await notificationAudienceQuery(subject);
  return { $and: [audience, ...preferenceClauses(prefs)] };
}

function tabClause(
  tab: NotificationInboxTab,
  subject: string,
): Record<string, unknown> {
  if (tab === "dismissed") return { dismissed_by_subjects: subject };
  // Unread and All both exclude dismissed rows: dismissing is the user saying
  // "stop showing me this", which an "All" tab should still respect.
  const notDismissed = { dismissed_by_subjects: { $ne: subject } };
  if (tab === "all") return notDismissed;
  return { $and: [notDismissed, { read_by_subjects: { $ne: subject } }] };
}

/**
 * One Mongo clause per filter dimension, kept separate so facet counts can be
 * taken with any single dimension left out.
 */
interface FilterClauses {
  entity?: Record<string, unknown>;
  /** Action and Tagged together, since one control sets both. */
  type?: Record<string, unknown>;
  important?: Record<string, unknown>;
  origin?: Record<string, unknown>;
}

/**
 * The query behind one Type facet, with the same expiry the labels use.
 *
 * "New" is a claim about now, so a row raised before the cutoff no longer
 * answers to it and answers to "Updated" instead. Without this the filter
 * and the row would disagree: a list filtered to New would show rows
 * labelled Updated.
 */
function actionClause(action: NotificationAction): Record<string, unknown> {
  const cutoff = new Date(
    Date.now() - NEW_FOR_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  return action === "new"
    ? { action: "new", created_at: { $gte: cutoff } }
    : {
        $or: [
          { action: "updated" },
          { action: "new", created_at: { $lt: cutoff } },
        ],
      };
}

/** The category test behind the TOME / Platform split, shared with the tag. */
function originClause(origin: NotificationOrigin): Record<string, unknown> {
  return {
    category:
      origin === "tome"
        ? { $in: TOME_NOTIFICATION_CATEGORIES }
        : { $nin: TOME_NOTIFICATION_CATEGORIES },
  };
}

async function filterClauses(
  filter: NotificationInboxFilter,
  subject: string,
): Promise<FilterClauses> {
  const clauses: FilterClauses = {};
  if (filter.entity) {
    // Selecting a BHAG or an Area means "and everything under it". Without
    // the subtree, filtering by either would come back empty, because
    // notifications are raised against the Projects below them.
    const slugs = await resolveFilterSubtree(filter.entity);
    clauses.entity = { entity_slug: { $in: slugs } };
  }
  // Action and Tagged live in one dropdown, so they widen together: asking
  // for "updated or tagged" has to mean either, not both at once.
  const type: Record<string, unknown>[] = [];
  if (filter.actions.length > 0) {
    type.push({ $or: filter.actions.map(actionClause) });
  }
  if (filter.tagged) type.push({ mention_subjects: subject });
  if (type.length === 1) clauses.type = type[0];
  else if (type.length > 1) clauses.type = { $or: type };

  if (filter.important) clauses.important = { needs_attention: true };
  if (filter.origin) clauses.origin = originClause(filter.origin);
  return clauses;
}

/** Compose the clauses, optionally leaving one dimension out. */
function combine(
  clauses: FilterClauses,
  except?: keyof FilterClauses,
): Record<string, unknown>[] {
  return (Object.keys(clauses) as (keyof FilterClauses)[])
    .filter((key) => key !== except)
    .map((key) => clauses[key])
    .filter((clause): clause is Record<string, unknown> => Boolean(clause));
}

/**
 * Slugs an entity filter covers. A missing entity yields just the slug itself
 * so a stale bookmark narrows to nothing rather than silently widening to the
 * whole inbox.
 */
async function resolveFilterSubtree(slug: string): Promise<string[]> {
  const entity = await resolveUniqueTomeProjectBySlug(slug);
  if (!entity) return [slug];
  const subtree = await resolveEntitySubtree(entity);
  return subtree.map((node) => node.slug);
}

function toView(
  row: InAppNotificationDocument,
  subject: string,
  watched: ReadonlySet<string>,
): InAppNotificationView {
  return {
    id: row._id,
    title: row.title,
    message: row.message,
    ...(row.href ? { href: row.href } : {}),
    severity: row.severity,
    category: row.category ?? "general",
    action: notificationAction(row),
    ...(row.source_label ? { source_label: row.source_label } : {}),
    ...(row.lifecycle_status ? { lifecycle_status: row.lifecycle_status } : {}),
    ...(row.resolved_at ? { resolved_at: row.resolved_at } : {}),
    ...(row.entity_slug ? { entity_slug: row.entity_slug } : {}),
    ...(row.entity_title ? { entity_title: row.entity_title } : {}),
    ...(row.event_label ? { event_label: row.event_label } : {}),
    ...(row.reference ? { reference: row.reference } : {}),
    ...(row.actor_name ? { actor_name: row.actor_name } : {}),
    created_at: row.created_at,
    read: row.read_by_subjects.includes(subject),
    needs_attention: row.needs_attention === true,
    mentioned: (row.mention_subjects ?? []).includes(subject),
    dismissed: (row.dismissed_by_subjects ?? []).includes(subject),
    following: row.entity_slug ? watched.has(row.entity_slug) : false,
  };
}

/**
 * Counts for every sidebar entry.
 *
 * Two deliberate choices. Counts are always of *unread* rows regardless of
 * the active tab, because the sidebar answers "where is my unread work" and
 * that question shouldn't change meaning when the reader switches to All.
 * And each group is counted with the other filters applied but not its own,
 * so a type reading 0 while a BHAG is selected means "none in here".
 */
async function buildFacets(
  subject: string,
  visible: Record<string, unknown>,
  prefs: NotificationPreferences,
  clauses: FilterClauses,
  selectedEntity?: string,
): Promise<NotificationInboxFacets> {
  const collection = await notifications();
  const unread = [
    visible,
    { read_by_subjects: { $ne: subject } },
    { dismissed_by_subjects: { $ne: subject } },
  ];
  const base = (except?: keyof FilterClauses) => ({
    $and: [...unread, ...combine(clauses, except)],
  });

  const [everything, needsAttention, mentions, byEntity] =
    await Promise.all([
      collection.countDocuments({ $and: unread } as never),
      collection.countDocuments({
        $and: [base("important"), { needs_attention: true }],
      } as never),
      collection.countDocuments({
        $and: [base("type"), { mention_subjects: subject }],
      } as never),
      collection
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              $and: [base("entity"), { entity_slug: { $exists: true } }],
            },
          },
          { $group: { _id: "$entity_slug", count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

  // Counted against everything *except* the origin choice, so switching
  // between TOME and Platform never shows a 0 you cannot click.
  const originCounts = Object.fromEntries(
    await Promise.all(
      (["tome", "platform"] as NotificationOrigin[]).map(
        async (origin) =>
          [
            origin,
            await collection.countDocuments({
              $and: [base("origin"), originClause(origin)],
            } as never),
          ] as const,
      ),
    ),
  ) as Partial<Record<NotificationOrigin, number>>;

  // Counted with the same clause the filter applies, so a facet never
  // promises rows that picking it would not return.
  const actions = Object.fromEntries(
    await Promise.all(
      NOTIFICATION_TYPE_FACETS.map(
        async ({ action }) =>
          [
            action,
            await collection.countDocuments({
              $and: [base("type"), actionClause(action)],
            } as never),
          ] as const,
      ),
    ),
  ) as Partial<Record<NotificationAction, number>>;

  return {
    everything,
    needs_attention: needsAttention,
    mentions,
    by_action: actions,
    by_origin: originCounts,
    by_entity: await buildEntityFacets(byEntity, prefs, selectedEntity),
  };
}

/**
 * The entity tree for the sidebar, with counts rolled up.
 *
 * Notifications only ever name the Project they happened in, so the Areas and
 * BHAGs above them have to be discovered from the hierarchy and credited with
 * their children's unread — otherwise every upper tier would read 0 and be
 * useless to filter by.
 */
async function buildEntityFacets(
  rows: ReadonlyArray<{ _id: string; count: number }>,
  prefs: NotificationPreferences,
  selected?: string,
): Promise<NotificationEntityFacet[]> {
  const ownCounts = new Map(rows.map((row) => [row._id, row.count]));
  // The selected entity is listed even when nothing matches, so the control
  // the reader just used cannot vanish from under them — and so its title is
  // still available to label the active-filter chip.
  const seeds = [...ownCounts.keys(), ...(selected ? [selected] : [])];
  if (seeds.length === 0) return [];
  const nodes = await resolveEntityAncestry(seeds);
  if (nodes.size === 0) return [];

  const rollup = new Map<string, number>();
  for (const [slug, count] of ownCounts) {
    // Credit the row's own entity and then every ancestor above it. The guard
    // bounds a label tag that points back into its own subtree.
    let cursor: string | undefined = slug;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      rollup.set(cursor, (rollup.get(cursor) ?? 0) + count);
      cursor = nodes.get(cursor)?.parent_slug;
    }
  }

  const muted = new Set(prefs.muted_entity_slugs);
  const facets: NotificationEntityFacet[] = [...nodes.values()].map((node) => ({
    entity_slug: node.slug,
    entity_title: node.title,
    entity_type: node.type,
    ...(node.parent_slug ? { parent_entity_slug: node.parent_slug } : {}),
    unread: rollup.get(node.slug) ?? 0,
    muted: muted.has(node.slug),
  }));
  return sortEntityFacets(facets);
}

/**
 * Depth-first order, so a child always follows its parent and the sidebar can
 * indent in a single pass. Entities whose parent isn't in the list are treated
 * as roots, so a nested entity never disappears.
 */
function sortEntityFacets(
  entities: readonly NotificationEntityFacet[],
): NotificationEntityFacet[] {
  const present = new Set(entities.map((entity) => entity.entity_slug));
  const childrenOf = new Map<string, NotificationEntityFacet[]>();
  const roots: NotificationEntityFacet[] = [];
  for (const entity of entities) {
    const parent = entity.parent_entity_slug;
    if (!parent || !present.has(parent)) {
      roots.push(entity);
      continue;
    }
    const bucket = childrenOf.get(parent) ?? [];
    bucket.push(entity);
    childrenOf.set(parent, bucket);
  }

  const byUnread = (a: NotificationEntityFacet, b: NotificationEntityFacet) =>
    b.unread - a.unread || a.entity_title.localeCompare(b.entity_title);

  const out: NotificationEntityFacet[] = [];
  const walk = (entity: NotificationEntityFacet, guard: Set<string>) => {
    if (guard.has(entity.entity_slug)) return;
    guard.add(entity.entity_slug);
    out.push(entity);
    for (const child of (childrenOf.get(entity.entity_slug) ?? []).sort(byUnread)) {
      walk(child, guard);
    }
  };
  const guard = new Set<string>();
  for (const root of roots.sort(byUnread)) walk(root, guard);
  return out;
}

export async function getNotificationInbox(
  principal: InboxPrincipal,
  options: {
    tab?: NotificationInboxTab;
    filter?: NotificationInboxFilter;
    limit?: number;
  } = {},
): Promise<NotificationInboxResponse> {
  const { subject, email } = principal;
  const prefs = await getNotificationPreferences(email);
  const tab = options.tab ?? "unread";
  const filter = options.filter ?? EMPTY_NOTIFICATION_FILTER;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, options.limit ?? 50));

  const collection = await notifications();
  const visible = await visibleQuery(subject, prefs);
  const clauses = await filterClauses(filter, subject);
  const query = {
    $and: [visible, tabClause(tab, subject), ...combine(clauses)],
  };

  const [rows, total, counts, facets, watchedEntities] = await Promise.all([
    collection
      .find(query as never)
      .sort({ created_at: -1, _id: -1 })
      .limit(limit)
      .toArray(),
    collection.countDocuments(query as never),
    // Tab counts carry the filter: switching from Unread to All should stay
    // inside whatever the reader narrowed to, and the number on the tab has
    // to agree with what the tab will actually show.
    countTabs(subject, visible, clauses),
    buildFacets(subject, visible, prefs, clauses, filter.entity),
    listSubjectWatchedEntities(subject),
  ]);

  const watched = new Set(watchedEntities.map((entity) => entity.entity_slug));
  return {
    notifications: rows.map((row) => toView(row, subject, watched)),
    facets,
    filter,
    total,
    counts,
    preferences: prefs,
  };
}

async function countTabs(
  subject: string,
  visible: Record<string, unknown>,
  clauses: FilterClauses,
): Promise<{ unread: number; all: number; dismissed: number }> {
  const collection = await notifications();
  const scoped = combine(clauses);
  const count = (tab: NotificationInboxTab) =>
    collection.countDocuments({
      $and: [visible, tabClause(tab, subject), ...scoped],
    } as never);
  const [unread, all, dismissed] = await Promise.all([
    count("unread"),
    count("all"),
    count("dismissed"),
  ]);
  return { unread, all, dismissed };
}

/**
 * Bulk read/dismiss. Scoped through the audience query so an id the caller was
 * never addressed by is silently skipped rather than mutated.
 */
export async function updateNotificationStates(
  subject: string,
  ids: readonly string[],
  change: { read?: boolean; dismissed?: boolean },
): Promise<number> {
  const targets = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!subject || targets.length === 0) return 0;

  const audience = await notificationAudienceQuery(subject);
  const add: Record<string, string> = {};
  const pull: Record<string, string> = {};
  if (change.read === true) add.read_by_subjects = subject;
  if (change.read === false) pull.read_by_subjects = subject;
  if (change.dismissed === true) {
    add.dismissed_by_subjects = subject;
    // Dismissing implies you are done with it; leaving it unread would keep it
    // in the unread count forever with no surface to clear it from.
    add.read_by_subjects = subject;
  }
  if (change.dismissed === false) pull.dismissed_by_subjects = subject;
  if (Object.keys(add).length === 0 && Object.keys(pull).length === 0) return 0;

  const collection = await notifications();
  const result = await collection.updateMany(
    { $and: [{ _id: { $in: targets } }, audience] } as never,
    {
      ...(Object.keys(add).length > 0 ? { $addToSet: add } : {}),
      ...(Object.keys(pull).length > 0 ? { $pull: pull } : {}),
      $set: { updated_at: new Date().toISOString() },
    } as never,
  );
  return result.matchedCount;
}

/**
 * The "Following" tab: the whole readable hierarchy, each node carrying
 * whether it is watched and how much is waiting underneath it.
 *
 * Counts use the same visibility rules as the inbox — audience, preferences,
 * dismissals — so a number here always matches what the Unread tab will
 * actually show for that entity.
 */
export async function getNotificationFollowTree(
  principal: InboxPrincipal & { isAdmin?: boolean },
): Promise<NotificationFollowTree> {
  const { subject, email, isAdmin } = principal;
  const [prefs, hierarchy, watched, watchedPages] = await Promise.all([
    getNotificationPreferences(email),
    resolveReadableHierarchy(subject, { isAdmin: isAdmin === true }),
    listSubjectWatchedEntities(subject),
    listSubjectWatchedPages(subject),
  ]);
  if (hierarchy.length === 0) return { nodes: [], total_unread: 0 };

  const collection = await notifications();
  const counts = await collection
    .aggregate<{ _id: string; count: number }>([
      {
        $match: {
          $and: [
            await visibleQuery(subject, prefs),
            { read_by_subjects: { $ne: subject } },
            { dismissed_by_subjects: { $ne: subject } },
            { entity_slug: { $in: hierarchy.map((node) => node.slug) } },
          ],
        },
      },
      { $group: { _id: "$entity_slug", count: { $sum: 1 } } },
    ])
    .toArray();

  const unreadBySlug = new Map(counts.map((row) => [row._id, row.count]));
  const following = new Set(watched.map((entity) => entity.entity_slug));
  const muted = new Set(prefs.muted_entity_slugs);

  // Roll each node's own count into every ancestor. The list is depth-first,
  // so walking it backwards means a node's children are already totalled by
  // the time it is reached.
  const subtotal = new Map<string, number>();
  const parentOfSlug = new Map(
    hierarchy.map((node) => [node.slug, node.parent_slug]),
  );
  for (const node of [...hierarchy].reverse()) {
    const own = unreadBySlug.get(node.slug) ?? 0;
    const total = own + (subtotal.get(node.slug) ?? 0);
    subtotal.set(node.slug, total);
    const parent = parentOfSlug.get(node.slug);
    if (parent) subtotal.set(parent, (subtotal.get(parent) ?? 0) + total);
  }

  // Watched pages hang off their entity as a fourth tier. They carry no
  // counts of their own: notifications are raised against the entity, so a
  // per-page number would always read zero and imply the page is quiet.
  const readable = new Set(hierarchy.map((node) => node.slug));
  const pageNodes: NotificationFollowTreeNode[] = watchedPages
    .filter((page) => readable.has(page.entity_slug))
    .map((page) => ({
      slug: `${page.entity_slug}#${page.page_path}`,
      // The folder part is already implied by where the row sits, so the
      // title is the file name and the full path rides along for the tooltip.
      title: page.page_path.split("/").pop() || page.page_path,
      type: "page" as const,
      parent_slug: page.entity_slug,
      entity_slug: page.entity_slug,
      page_path: page.page_path,
      following: true,
      muted: muted.has(page.entity_slug),
      unread: 0,
      subtree_unread: 0,
    }));
  const pagesByEntity = new Map<string, NotificationFollowTreeNode[]>();
  for (const page of pageNodes) {
    pagesByEntity.set(page.parent_slug as string, [
      ...(pagesByEntity.get(page.parent_slug as string) ?? []),
      page,
    ]);
  }

  return {
    nodes: hierarchy.flatMap((node) => [
      {
        slug: node.slug,
        title: node.title,
        type: node.type,
        ...(node.parent_slug ? { parent_slug: node.parent_slug } : {}),
        entity_slug: node.slug,
        following: following.has(node.slug),
        muted: muted.has(node.slug),
        unread: unreadBySlug.get(node.slug) ?? 0,
        subtree_unread: subtotal.get(node.slug) ?? 0,
      },
      ...(pagesByEntity.get(node.slug) ?? []).sort((a, b) =>
        a.title.localeCompare(b.title),
      ),
    ]),
    total_unread: hierarchy
      .filter((node) => !node.parent_slug)
      .reduce((sum, node) => sum + (subtotal.get(node.slug) ?? 0), 0),
  };
}
