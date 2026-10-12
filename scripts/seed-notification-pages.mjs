/**
 * Create the wiki pages the seeded notifications link to.
 *
 * Every notification points at a page rather than at the entity it happened
 * in, so the pages have to exist or the inbox is a list of broken links.
 * Run this before seed-notification-inbox.js; the paths here and the hrefs
 * there are the same list.
 *
 * Local development only. Safe to re-run: each save is just another revision.
 *
 * Usage: node scripts/seed-notification-pages.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? "http://localhost:33000";

/** `labels` is what the inbox reads to decide whether a row is important. */
const PAGES = [
  {
    entity: "skills-catalog",
    path: "demos/gateway-migration-walkthrough.md",
    title: "Gateway migration walkthrough",
    body: [
      "Recording of the end-to-end migration, taken against the 0.4 group API.",
      "",
      "- Length: 11 minutes",
      "- Covers: credential hand-off, replay of a failed batch, rollback",
    ].join("\n"),
  },
  {
    entity: "developer-experience",
    path: "roadmap.md",
    title: "Roadmap",
    labels: ["needs attention"],
    body: [
      "## Q4",
      "",
      "| Milestone | Date | Status |",
      "| --- | --- | --- |",
      "| Reference App GA | Nov 14 | At risk |",
      "| Self-serve onboarding | Dec 05 | On track |",
      "",
      "Non-engineering milestones now appear here alongside delivery work.",
    ].join("\n"),
  },
  {
    entity: "agent-gateway-hardening",
    path: "charter.md",
    title: "Charter",
    labels: ["critical"],
    body: [
      "## Scope",
      "",
      "Harden the agent gateway ahead of external traffic: authentication,",
      "rate limiting, and a replay-safe audit trail.",
      "",
      "## Open questions",
      "",
      "- Which auth model survives multi-tenant use?",
      "- Do we need per-skill quotas on day one?",
    ].join("\n"),
  },
  {
    entity: "developer-experience",
    path: "digests/weekly.md",
    title: "Weekly digest",
    body: [
      "## This week",
      "",
      "- 3 projects reported progress, 1 reported a blocker",
      "- 2 decisions settled, 1 raised",
      "- Reference App slipped a week; everything else held",
    ].join("\n"),
  },
  {
    entity: "agent-gateway-hardening",
    path: "decisions/auth-model.md",
    title: "Decision: gateway auth model",
    body: [
      "## Question",
      "",
      "How does the gateway authenticate callers once skills are invoked on",
      "behalf of a user rather than a service?",
      "",
      "## Options",
      "",
      "1. Service tokens with an on-behalf-of claim",
      "2. Per-user tokens minted at session start",
      "",
      "## Status",
      "",
      "Raised at the Sep 21 review. Options not yet filled in.",
    ].join("\n"),
  },
  {
    entity: "skills-catalog",
    path: "dependencies/gateway-group-api.md",
    title: "Dependency: gateway group API",
    labels: ["critical"],
    body: [
      "Needed for the Reference App milestone.",
      "",
      "- Owner: Platform Reliability",
      "- Promised: Oct 06",
      "- Now expected: Oct 20",
      "",
      "## Health",
      "",
      "Red. The slip puts the Reference App milestone outside its window.",
    ].join("\n"),
  },
  {
    entity: "onboarding-revamp",
    path: "collateral/onboarding-white-paper.md",
    title: "White paper: self-serve onboarding",
    body: [
      "Published for the field team.",
      "",
      "Covers the shape of the new onboarding flow, what it replaces, and",
      "the two questions customers ask most often about data handling.",
    ].join("\n"),
  },
  {
    entity: "observability-baseline",
    path: "status/october.md",
    title: "October status",
    body: [
      "## Progress",
      "",
      "- Trace sampling rolled out to three services",
      "- Dashboards migrated off the legacy exporter",
      "",
      "## Next",
      "",
      "- Alert routing review",
      "",
      "## Blocked",
      "",
      "- Waiting on retention policy sign-off",
    ].join("\n"),
  },
  {
    entity: "developer-experience",
    path: "decisions/oss-github-org.md",
    title: "Decision: OSS GitHub org",
    body: [
      "## Question",
      "",
      "Which GitHub organization do we publish the open-source packages under?",
      "",
      "## Decided",
      "",
      "The existing platform org, with a dedicated team for release rights.",
      "Settled in the BHAG and SLT review.",
    ].join("\n"),
  },
];

function markdown(page) {
  const frontmatter = [
    "---",
    `title: ${page.title}`,
    "kind: stable",
    ...(page.labels
      ? ["labels:", ...page.labels.map((label) => `  - ${label}`)]
      : []),
    "---",
    "",
  ].join("\n");
  return `${frontmatter}${page.body}\n`;
}

let created = 0;
for (const page of PAGES) {
  const url = `${BASE}/api/tome/projects/${page.entity}/pages/${page.path}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      markdown: markdown(page),
      message: `seed ${page.path}`,
      // Seeding should not page anybody.
      notify: { team: false, users: [] },
    }),
  });
  if (!response.ok) {
    console.error(`✗ ${page.entity}/${page.path} → ${response.status}`);
    continue;
  }
  created += 1;
  console.log(`✓ ${page.entity}/${page.path}`);
}

console.log(`\nwrote ${created} of ${PAGES.length} pages`);
