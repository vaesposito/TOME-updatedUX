/**
 * A small invented organisation, for showing the interface without a server.
 *
 * Every name here is made up and every address is on a reserved domain: this
 * is a prototype that will sit on a public page, and nothing in it should
 * look like anyone's real deployment.
 *
 * The shapes follow the API's own: where a payload is derived in the real
 * app — the wiki tree from its pages and folders — the prototype derives it
 * with the same function rather than hand-writing the result.
 */

export const USER = {
  name: "Avery Quinn",
  email: "avery.quinn@example.com",
  sub: "avery.quinn@example.com",
};

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

interface SpaceSeed {
  slug: string;
  title: string;
  description: string;
  type?: "project" | "area" | "bhag" | "subject";
  initiatives?: string[];
  areas?: string[];
  functions?: string[];
  categories?: string[];
  pages?: number;
  ingested?: number;
  edited?: number;
  steward?: string;
  team?: string;
  repos?: string[];
  spaces?: string[];
  rooms?: string[];
}

/**
 * The catalogue: one goal, two areas under it, the projects under those, and
 * the subjects that sit on the function axis instead.
 */
const SEEDS: SpaceSeed[] = [
  {
    slug: "ship-weekly",
    title: "Ship something every week",
    description:
      "The goal the platform teams are working to: a change in front of users every week, without a release being an event.",
    type: "bhag",
    pages: 12,
    ingested: 1,
    edited: 2,
    team: "Platform",
    steward: "Avery Quinn",
  },
  {
    slug: "delivery-platform",
    title: "Delivery platform",
    description:
      "Everything between a merged pull request and a running service: pipelines, environments and the tools around them.",
    type: "area",
    initiatives: ["ship-weekly"],
    pages: 24,
    ingested: 1,
    edited: 1,
    team: "Platform",
    steward: "Avery Quinn",
  },
  {
    slug: "developer-experience",
    title: "Developer experience",
    description:
      "How long it takes to go from an idea to a reviewed change, and how pleasant that is.",
    type: "area",
    initiatives: ["ship-weekly"],
    pages: 17,
    ingested: 3,
    edited: 2,
    team: "Platform",
    steward: "Sam Okafor",
  },
  {
    slug: "build-pipeline",
    title: "Build pipeline",
    description:
      "The shared build and test pipeline every service runs through, and the cache behind it.",
    initiatives: ["ship-weekly"],
    areas: ["delivery-platform"],
    pages: 31,
    ingested: 0,
    edited: 1,
    team: "Platform",
    steward: "Avery Quinn",
    repos: ["example-org/build-pipeline"],
    spaces: ["Delivery"],
    rooms: ["Pipeline standup"],
  },
  {
    slug: "environment-fleet",
    title: "Environment fleet",
    description:
      "Preview, staging and production environments: how they are created, kept alike, and torn down.",
    initiatives: ["ship-weekly"],
    areas: ["delivery-platform"],
    pages: 18,
    ingested: 2,
    edited: 4,
    team: "Platform",
    repos: ["example-org/environment-fleet"],
    rooms: ["Fleet weekly"],
    steward: "Sam Okafor",
  },
  {
    slug: "release-notes",
    title: "Release notes",
    description:
      "What went out, written so that someone outside the team can tell what changed.",
    initiatives: ["ship-weekly"],
    areas: ["delivery-platform"],
    pages: 9,
    ingested: 14,
    edited: 9,
    team: "Platform",
    steward: "Priya Raman",
  },
  {
    slug: "local-dev-setup",
    title: "Local development setup",
    description:
      "Getting a working copy of the stack on a laptop in under an hour, and keeping it working.",
    initiatives: ["ship-weekly"],
    areas: ["developer-experience"],
    pages: 22,
    ingested: 1,
    edited: 3,
    team: "Platform",
    repos: ["example-org/devbox"],
    spaces: ["Onboarding"],
    steward: "Sam Okafor",
  },
  {
    slug: "review-practice",
    title: "Review practice",
    description:
      "How changes get reviewed here: what reviewers look for, and what they leave to the tools.",
    initiatives: ["ship-weekly"],
    areas: ["developer-experience"],
    pages: 7,
    ingested: 5,
    edited: 6,
    team: "Platform",
    steward: "Avery Quinn",
  },
  // Subjects: standing concerns a team owns, on the function axis only.
  {
    slug: "incident-response",
    title: "Incident response",
    description:
      "How an incident is declared, who is called, and what is written down afterwards.",
    type: "subject",
    functions: ["Engineering"],
    categories: ["Reliability"],
    pages: 14,
    ingested: 2,
    edited: 2,
    team: "Operations",
    steward: "Jordan Bell",
    rooms: ["Incident bridge"],
  },
  {
    slug: "on-call-rota",
    title: "On-call rota",
    description:
      "Who is on call, how the handover works, and what can wait until morning.",
    type: "subject",
    functions: ["Engineering"],
    categories: ["Reliability"],
    pages: 6,
    ingested: 4,
    edited: 8,
    team: "Operations",
    steward: "Jordan Bell",
  },
  {
    slug: "access-reviews",
    title: "Access reviews",
    description:
      "The quarterly read through who can reach what, and the exceptions that were granted.",
    type: "subject",
    functions: ["Engineering"],
    categories: ["Security"],
    pages: 11,
    ingested: 6,
    edited: 11,
    team: "Security",
    steward: "Rowan Imani",
  },
  {
    slug: "dependency-policy",
    title: "Dependency policy",
    description:
      "Which third-party packages are allowed, who decides, and how an exception is recorded.",
    type: "subject",
    functions: ["Engineering"],
    categories: ["Security"],
    pages: 5,
    ingested: 21,
    edited: 30,
    team: "Security",
    steward: "Rowan Imani",
  },
  {
    slug: "developer-research",
    title: "Developer research",
    description:
      "What the people who use the platform say about it, and what was done in response.",
    type: "subject",
    functions: ["Product Design"],
    categories: ["Research"],
    pages: 9,
    ingested: 7,
    edited: 4,
    team: "Design",
    steward: "Sam Okafor",
  },
  {
    slug: "launch-notes",
    title: "Launch notes",
    description:
      "How a change is announced outside engineering, and who needs to hear about it first.",
    type: "subject",
    functions: ["Marketing"],
    categories: ["Launches"],
    pages: 4,
    ingested: 10,
    edited: 7,
    team: "Marketing",
    steward: "Priya Raman",
  },
];

/** An invented address for an invented person, on a reserved domain. */
function emailFor(name: string): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, ".")}@example.com`;
}

function space(seed: SpaceSeed) {
  const sources: Record<string, unknown> = {};
  if (seed.repos?.length) {
    sources.github = { repos: seed.repos.map((repo) => ({ repo, branch: "main" })) };
  }
  if (seed.spaces?.length) {
    sources.confluence = { spaces: seed.spaces.map((key) => ({ key, title: key })) };
  }
  if (seed.rooms?.length) {
    sources.webex = {
      rooms: seed.rooms.map((title, index) => ({ id: `room-${index}`, title })),
    };
  }

  return {
    _id: `space-${seed.slug}`,
    type: seed.type ?? "project",
    slug: seed.slug,
    title: seed.title,
    description: seed.description,
    team_id: `team-${(seed.team ?? "platform").toLowerCase()}`,
    team_slug: (seed.team ?? "Platform").toLowerCase(),
    team_name: seed.team ?? "Platform",
    owner_id: USER.sub,
    member_ids: [USER.sub],
    domain: "example.com",
    labels: {
      initiatives: seed.initiatives ?? [],
      areas: seed.areas ?? [],
      functions: seed.functions ?? [],
      categories: seed.categories ?? [],
    },
    tags: [],
    status: "active",
    catalog: {},
    components: [],
    onboarding: {},
    integrations: {},
    sources,
    data_steward: seed.steward
      ? {
          type: "user" as const,
          id: emailFor(seed.steward),
          name: seed.steward,
          email: emailFor(seed.steward),
        }
      : undefined,
    page_count: seed.pages ?? 0,
    last_ingested_at: ago(seed.ingested ?? 1),
    last_edited_at: ago(seed.edited ?? 1),
    active_ingests: [],
    created_at: ago(120),
    updated_at: ago(seed.edited ?? 1),
  };
}

export const SPACES = SEEDS.map(space);

export const PROJECTS = SPACES.filter((s) => s.type === "project");
export const SUBJECTS = SPACES.filter((s) => s.type === "subject");
export const AREAS = SPACES.filter((s) => s.type === "area");
export const BHAGS = SPACES.filter((s) => s.type === "bhag");

export function spaceBySlug(slug: string) {
  return SPACES.find((s) => s.slug === slug);
}

/**
 * The tier above each space, by slug.
 *
 * The labels record which goal and area a space belongs to; the tree every
 * screen draws needs the single step upwards, so it is derived once here
 * rather than re-derived in each of them.
 */
export const PARENT_OF: Record<string, string | undefined> = Object.fromEntries(
  SEEDS.map((seed) => [
    seed.slug,
    seed.areas?.[0] ?? seed.initiatives?.[0] ?? undefined,
  ]),
);

/** Everything one step below a space. */
export function childrenOf(slug: string) {
  return SPACES.filter((space) => PARENT_OF[space.slug] === slug);
}

/**
 * What this deployment calls the divisions of each function's work.
 *
 * Set in `next.config.ts`, the way an operator sets it, and read back here so
 * the exported addresses and the names the browser draws come from one
 * string rather than two that can drift apart.
 */
export const CONFIGURED_CATEGORIES =
  process.env.NEXT_PUBLIC_TOME_FUNCTION_CATEGORIES ?? "";

/**
 * A wiki, as markdown with frontmatter — the form the store keeps and the
 * editor reads, so the prototype's pages behave like real ones.
 */
export const PAGES: Record<string, Record<string, string>> = {
  "build-pipeline": {
    "overview.md": `---
title: Overview
kind: dynamic
order: 0
updated_by: tome-agent
---

The shared build and test pipeline every service runs through, and the cache behind it.

## What this is

Every service in the delivery platform builds through one pipeline definition,
kept in \`example-org/build-pipeline\`. A service opts in by adding a four-line
workflow that calls it; nothing else is copied between repositories.

## Where it stands

The remote cache has been in front of the pipeline for three weeks. Median
build time on the ten busiest repositories fell from 11 minutes to 4, and the
cache now answers about two thirds of all steps.

## What is next

Cache eviction is still manual. The team has agreed to move it to a size-based
policy before taking on any more repositories — see [Roadmap](roadmap.md).
`,
    "architecture.md": `---
title: Architecture
kind: dynamic
order: 10
updated_by: tome-agent
---

## Shape

Three stages, run in order, each able to short-circuit on a cache hit:

1. **Resolve** — read the lockfile, fetch dependencies, warm the cache key.
2. **Build** — compile and package; artefacts are content-addressed.
3. **Verify** — unit tests, then whatever the service declares as its own.

## Why it is one definition

A pipeline copied into forty repositories is forty pipelines. One definition
with declared inputs is a single thing to reason about, and the only cost is
that a service cannot quietly diverge — which is the point.
`,
    "roadmap.md": `---
title: Roadmap
kind: stable
order: -4
updated_by: avery.quinn@example.com
---

## Now

- Size-based cache eviction, replacing the manual sweep.
- Publish build timings to the platform dashboard.

## Next

- Per-service verify budgets, so one slow suite cannot hold the queue.
- Opt-in build provenance.

## Not now

- Windows runners. Nothing in the fleet needs them yet.
`,
    "decisions/cache-key.md": `---
title: What goes into a cache key
kind: stable
order: 0
updated_by: avery.quinn@example.com
---

The key is the hash of the lockfile, the toolchain version and the build
inputs — and nothing else. Branch and author were in the key for a fortnight
and made every first build on a branch a miss.

Agreed in the pipeline standup on the 3rd; see the meeting notes for the
dissent, which was about reproducibility of vendored dependencies.
`,
    "memory.md": `---
title: Memory
kind: hidden
order: 100
updated_by: tome-agent
---

Working notes the agent keeps for itself between ingests.
`,
  },
  "incident-response": {
    "overview.md": `---
title: Overview
kind: dynamic
order: 0
updated_by: tome-agent
---

How an incident is declared, who is called, and what is written down afterwards.

## What this is

A subject rather than a project: nobody finishes incident response. It holds
the current practice, the rota it depends on, and the reviews that come out of
each incident.

## Where it stands

The declaration path is down to one command in the incident bridge. Three of
the last five incidents were declared by someone outside the operations team,
which is the point of it being one command.

## What is next

Write-ups still arrive as pasted chat logs about half the time. The next
change is a template the bridge posts when an incident closes.
`,
    "charter.md": `---
title: Charter
kind: stable
order: -5
updated_by: jordan.bell@example.com
---

## Why this exists

So that declaring an incident is never a judgement call about whether you are
allowed to.

## What good looks like

Anyone can declare. The first responder's only job is to find the second. The
write-up is readable by someone who was asleep.
`,
    "memory.md": `---
title: Memory
kind: hidden
order: 100
updated_by: tome-agent
---

Working notes the agent keeps for itself between ingests.
`,
  },
};

/** Spaces with no hand-written wiki still answer with their founding page. */
export function pagesFor(slug: string): Record<string, string> {
  if (PAGES[slug]) return PAGES[slug];
  const found = spaceBySlug(slug);
  return {
    "overview.md": `---
title: Overview
kind: dynamic
order: 0
updated_by: tome-agent
---

${found?.description ?? "A space in TOME."}

## What this is

This page is written by the agent from the sources attached to the space, and
rewritten on every ingest.

## Where it stands

Nothing has been read from this space's sources yet in the prototype.
`,
  };
}

export const FOLDERS: Record<string, { id: string; name: string; parent_id: string | null; order: number }[]> = {
  "build-pipeline": [
    { id: "folder-decisions", name: "Decisions", parent_id: null, order: 0 },
  ],
};

export const TEAM: Record<string, unknown> = {
  team: { slug: "platform", name: "Platform" },
  members: [
    { name: "Avery Quinn", email: "avery.quinn@example.com", role: "owner" },
    { name: "Jordan Bell", email: "jordan.bell@example.com", role: "member" },
    { name: "Rowan Imani", email: "rowan.imani@example.com", role: "member" },
    { name: "Sam Okafor", email: "sam.okafor@example.com", role: "member" },
    { name: "Priya Raman", email: "priya.raman@example.com", role: "member" },
  ],
  total: 5,
  steward: "Avery Quinn",
  watchers: 6,
};

export const MEETING_SERIES = [
  {
    id: "series-standup",
    title: "Pipeline standup",
    series_id: "series-standup",
    host_email: "avery.quinn@example.com",
    cadence: "Weekly on Tuesday",
    schedule: "Tuesdays, 09:30",
    enabled: true,
    created_at: ago(60),
    updated_at: ago(6),
    last_ingested_at: ago(6),
    occurrence_count: 14,
  },
];

export const OCCURRENCES = [
  {
    id: "occ-14",
    series_id: "series-standup",
    title: "Pipeline standup",
    start: ago(6),
    end: ago(5.97),
    ingested_at: ago(6),
    status: "ingested",
    transcript_available: true,
  },
  {
    id: "occ-13",
    series_id: "series-standup",
    title: "Pipeline standup",
    start: ago(13),
    end: ago(12.97),
    ingested_at: ago(13),
    status: "ingested",
    transcript_available: true,
  },
];

export const INGEST_RUNS = [
  {
    id: "run-1",
    run_id: "run-1",
    status: "succeeded",
    mode: "ingest",
    started_at: ago(1),
    finished_at: ago(0.98),
    duration_ms: 118_000,
    pages_written: 4,
    pages_reviewed: 0,
    started_by: "tome-agent",
    actor: "tome-agent",
    sources: ["github", "webex"],
    summary: "Four pages rewritten from the last fortnight of pull requests and two standups.",
  },
  {
    id: "run-2",
    run_id: "run-2",
    status: "succeeded",
    mode: "ingest",
    started_at: ago(8),
    finished_at: ago(7.97),
    duration_ms: 142_000,
    pages_written: 6,
    pages_reviewed: 1,
    started_by: "avery.quinn@example.com",
    actor: "avery.quinn@example.com",
    sources: ["github"],
    summary: "First read of the repository: six pages written, one held back for review.",
  },
];

/** Decisions and risks, as the critical-items route reports them. */
export const CRITICAL_ITEMS = [
  {
    id: "ci-eviction",
    type: "decision",
    title: "Cache eviction moves to a size-based policy",
    status: "open",
    priority: "high",
    owner: "Avery Quinn",
    opened: ago(9),
    closed: null,
    target: ago(-3),
    body: "Agreed to settle this before any more repositories are onboarded. The manual sweep has been missed twice.",
    source_project_slug: "build-pipeline",
    path: "roadmap.md",
  },
  {
    id: "ci-vendored",
    type: "risk",
    title: "Vendored dependencies are not reproducible across runners",
    status: "open",
    priority: "medium",
    owner: null,
    opened: ago(3),
    closed: null,
    target: null,
    body: "Raised in the pipeline standup and still without an owner.",
    source_project_slug: "build-pipeline",
    path: "decisions/cache-key.md",
  },
  {
    id: "ci-key",
    type: "decision",
    title: "Cache keys exclude the branch and the author",
    status: "closed",
    priority: "high",
    owner: "Avery Quinn",
    opened: ago(21),
    closed: ago(12),
    target: null,
    body: "Branch in the key made every first build on a branch a miss.",
    source_project_slug: "build-pipeline",
    path: "decisions/cache-key.md",
  },
];

export const GISTS = [
  {
    id: "gist-weekly",
    title: "Weekly pipeline prompt",
    filename: "weekly-pipeline-prompt.md",
    body: "Summarise what changed in the pipeline this week, citing the runs it came from. Keep it to five lines and say what is still open.",
    author: "avery.quinn@example.com",
    created_at: ago(30),
    updated_at: ago(5),
    updated_by: "avery.quinn@example.com",
    tags: ["prompt"],
  },
  {
    id: "gist-runbook",
    title: "What to check when a build hangs",
    filename: "build-hangs.md",
    body: "Look at the cache first: a hung resolve step is almost always a cache key that is being written and read at once.",
    author: "jordan.bell@example.com",
    created_at: ago(18),
    updated_at: ago(18),
    updated_by: "jordan.bell@example.com",
    tags: ["runbook"],
  },
];

/** Glossary entries carry the shape the glossary route reports. */
export const GLOSSARY_TERMS = [
  {
    path: "glossary/cache-key.md",
    term: "Cache key",
    expansion: null,
    aliases: ["key"],
    scope: "build-pipeline",
    termKind: "concept",
    status: "approved",
    definition:
      "The hash that decides whether a build step can be skipped: the lockfile, the toolchain version and the build inputs, and nothing else.",
  },
  {
    path: "glossary/verify-budget.md",
    term: "Verify budget",
    expansion: null,
    aliases: ["budget"],
    scope: "build-pipeline",
    termKind: "concept",
    status: "draft",
    definition:
      "The time a service's own test suite is allowed before the queue moves on without it.",
  },
  {
    path: "glossary/pr.md",
    term: "PR",
    expansion: "Pull request",
    aliases: ["pull request", "change"],
    scope: "build-pipeline",
    termKind: "acronym",
    status: "approved",
    definition:
      "A proposed change to a repository, reviewed before it is merged. The pipeline runs on every one of them.",
  },
];
