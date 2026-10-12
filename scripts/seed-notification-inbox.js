/**
 * Seed the notification inbox with one example of every content type, so
 * /notifications has realistic content in local development.
 *
 * Three things hold across every row:
 *
 *  - It links to a page. Not to the entity it happened in — a reader who
 *    clicks wants the thing itself, and a link to a landing page is a
 *    detour dressed up as an answer. The targets are written by
 *    seed-notification-pages.mjs, which must run first.
 *  - It can be dismissed, or left alone.
 *  - It is important, or it is not. There is no grading beyond that.
 *
 * Local development only. Safe to re-run: documents are keyed by a stable
 * `_id`, so editing the list below replaces the previous run in place.
 *
 * Usage: node scripts/seed-notification-pages.mjs
 *        docker exec -i <mongo> mongosh --quiet "$MONGODB_URI" \
 *          --file /path/to/seed-notification-inbox.js
 *
 * Remove with: db.in_app_notifications.deleteMany({ _id: /^demo-inbox-/ })
 */

const SUBJECT = "anonymous-local-dev";
const TEAM = "platform-engineering";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Entity hierarchy mirrors the seeded projects: areas own projects.
const AREA = { slug: "developer-experience", title: "Developer Experience" };
const RELIABILITY = { slug: "platform-reliability", title: "Platform Reliability" };
const CATALOG = { slug: "skills-catalog", title: "Skills Catalog" };
const GATEWAY = { slug: "agent-gateway-hardening", title: "Agent Gateway Hardening" };
const ONBOARDING = { slug: "onboarding-revamp", title: "Onboarding Revamp" };
const OBSERVABILITY = { slug: "observability-baseline", title: "Observability Baseline" };

/**
 * One row per content type. `page` is the wiki path the row opens; `action`
 * is whether it announces something new or a change to something existing;
 * `important` is the whole of its criticality.
 *
 * `actor` is who made the change, and is what the row shows under its
 * headline. Rows the platform rolls up by itself — the weekly digest, a
 * posted status — have none, because nobody wrote them. `message` is only
 * for the tagged row, where it is one person's words to the reader.
 */
const ITEMS = [
  {
    category: "demo",
    action: "new",
    eventLabel: "New demo video",
    title: "Walkthrough recorded for the gateway migration",
    actor: "Dana Okafor",
    entity: CATALOG,
    parent: AREA.slug,
    page: "demos/gateway-migration-walkthrough.md",
    age: 3 * HOUR,
  },
  {
    category: "roadmap_change",
    action: "updated",
    eventLabel: "Roadmap change",
    title: "Reference App GA moved to Nov 14",
    actor: "Priya Raman",
    entity: AREA,
    page: "roadmap.md",
    // Execution is at risk, which is the whole reason to interrupt someone.
    important: true,
    age: 5 * HOUR,
  },
  // Someone wrote this line for this reader. It is the one kind of row that
  // is addressed rather than broadcast, so it carries their words verbatim.
  {
    // Files as Collateral because the artifact is a wiki page. The category
    // says what was touched, not why you were told, and it is what marks the
    // row as TOME rather than platform news.
    category: "collateral",
    action: "new",
    eventLabel: "Requires my attention",
    title: "Priya Raman tagged you in Charter",
    message: "@avery please verify the auth section before Thursday",
    actor: "Priya Raman",
    entity: GATEWAY,
    parent: RELIABILITY.slug,
    page: "charter.md",
    mention: true,
    important: true,
    age: 7 * HOUR,
  },
  {
    category: "status_update",
    action: "new",
    eventLabel: "Summary digest",
    title: "This week in Developer Experience",
    entity: AREA,
    page: "digests/weekly.md",
    age: 1 * DAY,
  },
  {
    category: "decision",
    action: "new",
    eventLabel: "Decisions",
    title: "1 decision pending in Agent Gateway Hardening",
    actor: "Jordan Mapfumo",
    entity: GATEWAY,
    parent: RELIABILITY.slug,
    page: "decisions/auth-model.md",
    reference: "REL#70",
    age: 1 * DAY + 4 * HOUR,
  },
  {
    category: "dependency",
    action: "new",
    eventLabel: "New dependency",
    title: "Skills Catalog now depends on the gateway group API",
    actor: "Sam Whitfield",
    entity: CATALOG,
    parent: AREA.slug,
    page: "dependencies/gateway-group-api.md",
    age: 2 * DAY,
  },
  {
    category: "collateral",
    action: "new",
    eventLabel: "New collateral",
    title: "White paper published for self-serve onboarding",
    actor: "Dana Okafor",
    entity: ONBOARDING,
    parent: AREA.slug,
    page: "collateral/onboarding-white-paper.md",
    age: 3 * DAY,
  },
  {
    category: "dependency",
    action: "updated",
    eventLabel: "Dependency health change",
    title: "Gateway group API went from yellow to red",
    actor: "Sam Whitfield",
    entity: CATALOG,
    parent: AREA.slug,
    page: "dependencies/gateway-group-api.md",
    important: true,
    age: 4 * DAY,
  },
  {
    category: "decision",
    action: "updated",
    eventLabel: "Decision status change",
    title: "Decided: publish under the existing platform org",
    actor: "Jordan Mapfumo",
    entity: AREA,
    page: "decisions/oss-github-org.md",
    reference: "DX#50",
    resolved: true,
    read: true,
    age: 6 * DAY,
  },
  {
    category: "status_update",
    action: "updated",
    eventLabel: "Area status change",
    title: "Observability Baseline posted October status",
    entity: OBSERVABILITY,
    parent: RELIABILITY.slug,
    page: "status/october.md",
    read: true,
    age: 8 * DAY,
  },
];

const collection = db.getCollection("in_app_notifications");

// Re-running with a shorter list should not leave the old rows behind.
collection.deleteMany({ _id: /^demo-inbox-/ });

ITEMS.forEach((item, index) => {
  const id = `demo-inbox-${index}`;
  const createdAt = new Date(Date.now() - item.age).toISOString();
  collection.replaceOne(
    { _id: id },
    {
      _id: id,
      event_key: `demo.inbox.${item.entity.slug}.${index}`,
      recipient_user_subjects: [SUBJECT],
      recipient_team_slugs: [TEAM],
      recipient_organization_admins: false,
      recipient_platform_users: false,
      title: item.title,
      message: item.message ?? "",
      ...(item.actor ? { actor_name: item.actor } : {}),
      // Same shape notifyPageSaved writes, extension and all, so seeded rows
      // and real ones are indistinguishable.
      href: `/projects/${item.entity.slug}/tome/wiki/${item.page}`,
      // Importance is the only level there is, so severity carries no
      // grading of its own beyond marking a row as one to act on.
      severity: item.important ? "error" : "info",
      action: item.action,
      category: item.category,
      event_label: item.eventLabel,
      entity_slug: item.entity.slug,
      entity_title: item.entity.title,
      ...(item.parent ? { parent_entity_slug: item.parent } : {}),
      ...(item.reference ? { reference: item.reference } : {}),
      ...(item.important ? { needs_attention: true } : {}),
      ...(item.mention ? { mention_subjects: [SUBJECT] } : {}),
      ...(item.resolved
        ? { lifecycle_status: "resolved", resolved_at: createdAt }
        : {}),
      source_label: "TOME",
      created_at: createdAt,
      updated_at: createdAt,
      read_by_subjects: item.read ? [SUBJECT] : [],
      dismissed_by_subjects: [],
    },
    { upsert: true },
  );
});

print(`seeded ${ITEMS.length} inbox notifications for ${SUBJECT}`);
