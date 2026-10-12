/**
 * Seed demo "Watching" notifications for the local no-SSO dev user so the
 * header bell has something to show. Local development only; safe to re-run —
 * every document is keyed by event_key and replaced in place.
 *
 * Usage: docker exec -i <mongo> mongosh --quiet "$MONGODB_URI" \
 *          --file /path/to/seed-watch-notifications.js
 */

const SUBJECT = "anonymous-local-dev";

// [title, message, hours ago, entity slug]. Slugs point at the locally seeded
// entities so every row is clickable rather than landing on a 404.
const ITEMS = [
  ["Skills Catalog", "New demo video", 1, "skills-catalog"],
  ["Knowledge Base Ingestion", "Roadmap change", 2, "knowledge-base-ingestion"],
  ["Agent Gateway Hardening", "Requires my attention", 3, "agent-gateway-hardening"],
  ["Agent Gateway Hardening", "New collateral", 5, "agent-gateway-hardening"],
  ["Observability Baseline", "New dependency", 8, "observability-baseline"],
  ["Observability Baseline", "Dependency health change", 14, "observability-baseline"],
  ["Onboarding Revamp", "Decision status change", 26, "onboarding-revamp"],
  ["Developer Experience", "Status change", 50, "developer-experience"],
];

const collection = db.getCollection("in_app_notifications");
let written = 0;

ITEMS.forEach(([title, message, hoursAgo, slug], index) => {
  const createdAt = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  const id = `demo-watch-${index}`;
  // Keyed on _id, not event_key, so editing the list above still replaces the
  // previous run's documents instead of colliding with them.
  collection.replaceOne(
    { _id: id },
    {
      _id: id,
      event_key: `tome.watch.demo.${slug}.${index}`,
      recipient_user_subjects: [SUBJECT],
      recipient_team_slugs: [],
      recipient_organization_admins: false,
      recipient_platform_users: false,
      title,
      message,
      href: `/projects/${slug}/tome`,
      severity: "info",
      category: "general",
      source_label: "Watching",
      created_at: createdAt,
      updated_at: createdAt,
      read_by_subjects: [],
    },
    { upsert: true },
  );
  written += 1;
});

print(`seeded ${written} watching notifications for ${SUBJECT}`);
