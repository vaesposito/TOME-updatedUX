/**
 * The server, replaced by a function.
 *
 * The prototype is a static site: there is nowhere for a request to go. Every
 * screen in TOME asks the API for what it shows, so rather than rewriting the
 * screens, the prototype answers them — `fetch` is replaced before anything
 * renders, and the routes below reply with the same envelope the real API
 * uses (`{ data }`) from the fixtures next door.
 *
 * Writes are accepted and kept in memory for the session, so the prototype
 * behaves like the application for the length of a visit: follow a space,
 * edit a page, create a folder, mark something read. Nothing survives a
 * reload, which is the honest thing for a prototype to do.
 */

import { buildTree } from "@/lib/tome/schema";

import {
  childrenOf,
  CRITICAL_ITEMS,
  FOLDERS,
  GISTS,
  GLOSSARY_TERMS,
  INGEST_RUNS,
  MEETING_SERIES,
  OCCURRENCES,
  pagesFor,
  PARENT_OF,
  SPACES,
  spaceBySlug,
  TEAM,
  USER,
} from "./data";
import { FOLLOWED, followTree, inbox, ROWS, summaryFor } from "./notifications";

type Json = Record<string, unknown>;

/** What the session has changed, for as long as the tab is open. */
const session = {
  pages: new Map<string, Record<string, string>>(),
  folders: new Map<string, { id: string; name: string; parent_id: string | null; order: number }[]>(),
  following: new Set<string>(FOLLOWED),
  read: new Set<string>(),
};

function pages(slug: string): Record<string, string> {
  if (!session.pages.has(slug)) session.pages.set(slug, { ...pagesFor(slug) });
  return session.pages.get(slug) as Record<string, string>;
}

function folders(slug: string) {
  if (!session.folders.has(slug)) session.folders.set(slug, [...(FOLDERS[slug] ?? [])]);
  return session.folders.get(slug) as {
    id: string;
    name: string;
    parent_id: string | null;
    order: number;
  }[];
}

function wiki(slug: string) {
  const own = pages(slug);
  const kept = folders(slug).map((folder) => ({
    ...folder,
    project_id: `space-${slug}`,
    name_key: folder.name.toLowerCase(),
    source_path: null,
    owner_subject: USER.sub,
    permission_scope: "project",
    created_at: new Date(),
    updated_at: new Date(),
    updated_by: USER.sub,
  }));
  return {
    slug,
    pages: own,
    folders: kept,
    // Derived the way the server derives it, so the rail, the indexes and the
    // breadcrumbs all agree with each other.
    tree: buildTree(own, kept as never),
    placements: {},
    canEdit: true,
  };
}

/** A space, shaped the way the child and overview routes report one. */
function childRow(slug: string) {
  const space = spaceBySlug(slug);
  return {
    slug,
    title: space?.title ?? slug,
    type: space?.type ?? "project",
    ...(PARENT_OF[slug] ? { parent_slug: PARENT_OF[slug] } : {}),
    status: space?.status,
    page_count: space?.page_count ?? 0,
    last_ingested_at: space?.last_ingested_at ?? null,
    last_edited_at: space?.last_edited_at ?? null,
    ingesting: null,
    sources: space?.sources ?? {},
    ...(space?.data_steward ? { steward: space.data_steward.name } : {}),
    owner: space?.owner_id,
    team: { slug: space?.team_slug ?? "platform", name: space?.team_name ?? "Platform" },
  };
}

/** Everything one step or more below a space, depth-first. */
function descendants(slug: string): string[] {
  return childrenOf(slug).flatMap((child) => [child.slug, ...descendants(child.slug)]);
}

/** The catalogue, filtered the way `/api/projects` filters it. */
function projects(url: URL) {
  const type = url.searchParams.get("type");
  const initiative = url.searchParams.get("initiative");
  const area = url.searchParams.get("area");
  let found = SPACES.filter((space) =>
    type ? space.type === type : space.type === "project" || space.type === "subject",
  );
  if (initiative) {
    found = found.filter((space) => (space.labels.initiatives ?? []).includes(initiative));
  }
  if (area) {
    found = found.filter((space) => (space.labels.areas ?? []).includes(area));
  }
  return { projects: found };
}

/** Everything the prototype knows how to answer, in the order it is tried. */
const ROUTES: [RegExp, (match: RegExpMatchArray, url: URL, init: RequestInit) => Json | null][] = [
  // The shell: who is signed in, and what this deployment calls itself.
  [/^\/api\/auth\/session$/, () => null],
  [/^\/api\/users\/me$/, () => ({ user: USER })],
  [/^\/api\/users\/search$/, () => ({ users: [] })],
  [/^\/api\/version$/, () => ({ version: "prototype", commit: "prototype" })],
  [/^\/api\/auth\/role$/, () => ({ role: "admin" })],
  [/^\/api\/rbac\/permissions$/, () => ({ permissions: [] })],
  [/^\/api\/rbac\/(admin|kb)-tab-gates$/, () => ({ gates: {} })],
  [/^\/api\/settings(\/preferences)?$/, () => ({ settings: {}, preferences: {} })],
  [/^\/api\/admin\/platform-config$/, () => ({ config: {} })],
  [/^\/api\/platform\/health$/, () => ({ status: "ok", components: [] })],

  // The catalogue and its two axes.
  [/^\/api\/projects$/, (_m, url) => projects(url)],
  [/^\/api\/projects\/catalog$/, () => ({ entries: [], projects: [] })],
  [/^\/api\/projects\/onboarding-config$/, () => ({ steps: [], required: [] })],
  [/^\/api\/projects\/source-options$/, () => ({ options: [] })],
  [/^\/api\/tome\/admin$/, () => ({ is_admin: true, admins: [USER.email] })],
  [/^\/api\/tome\/preferences\/bhag-order$/, () => ({ order: [] })],
  [
    /^\/api\/tome\/overview$/,
    (_m, url) => ({
      summary: summaryFor("", url.searchParams.get("scope") === "for_me" ? "for_me" : "all"),
      spaces: SPACES.map((space) => childRow(space.slug)),
      total: SPACES.length,
      withheld: 0,
    }),
  ],
  [
    /^\/api\/projects\/([^/]+)\/summary$/,
    (match, url) =>
      summaryFor(
        decodeURIComponent(match[1]),
        url.searchParams.get("scope") === "for_me" ? "for_me" : "all",
      ) as unknown as Json,
  ],
  [
    /^\/api\/projects\/([^/]+)$/,
    (match) => ({ project: spaceBySlug(decodeURIComponent(match[1])) ?? null }),
  ],

  // Following, and what has arrived.
  [/^\/api\/notifications\/following$/, () => followTree(session.following) as unknown as Json],
  [/^\/api\/notifications\/inbox$/, (_m, url) => inbox(url) as unknown as Json],
  [/^\/api\/notifications\/delivery$/, () => ({ targets: [], webex: null })],
  [/^\/api\/notifications\/preferences$/, () => ({ muted_entity_slugs: [] })],
  [
    /^\/api\/notifications\/(read-all|bulk)$/,
    () => {
      for (const row of ROWS) session.read.add(row.id);
      return { updated: ROWS.length };
    },
  ],
  [
    /^\/api\/notifications\/([^/]+)$/,
    (match, _url, init) => {
      const id = decodeURIComponent(match[1]);
      if (init.method !== "GET") session.read.add(id);
      return { id, read: session.read.has(id) };
    },
  ],
  [
    /^\/api\/notifications$/,
    () => ({
      notifications: ROWS.map((row) => ({
        ...row,
        read: row.read || session.read.has(row.id),
      })),
      unread_count: ROWS.filter((row) => !row.read && !session.read.has(row.id)).length,
      pagination: { page: 1, page_size: 50, total: ROWS.length, total_pages: 1 },
    }),
  ],
  [
    /^\/api\/projects\/([^/]+)\/watch$/,
    (match, _url, init) => {
      const slug = decodeURIComponent(match[1]);
      if (init.method !== "GET") {
        const body = init.body ? (JSON.parse(String(init.body)) as Json) : {};
        const wanted = body.watching ?? !session.following.has(slug);
        if (wanted) session.following.add(slug);
        else session.following.delete(slug);
      }
      return {
        watching: session.following.has(slug),
        watcher_count: session.following.has(slug) ? 6 : 5,
      };
    },
  ],

  // A space's wiki.
  [
    /^\/api\/tome\/projects\/([^/]+)\/pages$/,
    (match) => wiki(decodeURIComponent(match[1])),
  ],
  [
    /^\/api\/tome\/projects\/([^/]+)\/pages\/(.+)$/,
    (match, _url, init) => {
      const slug = decodeURIComponent(match[1]);
      const path = decodeURIComponent(match[2]);
      const own = pages(slug);
      if (init.method === "PUT" || init.method === "POST") {
        const body = init.body ? (JSON.parse(String(init.body)) as Json) : {};
        if (typeof body.content === "string") own[path] = body.content;
        return { slug, path, saved: true };
      }
      if (init.method === "DELETE") {
        delete own[path];
        return { slug, path, deleted: true };
      }
      return { slug, path, content: own[path] ?? "", canEdit: true };
    },
  ],
  [
    /^\/api\/tome\/projects\/([^/]+)\/folders$/,
    (match, _url, init) => {
      const slug = decodeURIComponent(match[1]);
      if (init.method === "POST") {
        const body = init.body ? (JSON.parse(String(init.body)) as Json) : {};
        const id = `folder-${Date.now()}`;
        folders(slug).push({
          id,
          name: String(body.name ?? "New folder"),
          parent_id: (body.parent_id as string | null) ?? null,
          order: folders(slug).length,
        });
        return { folder: { id, name: body.name } };
      }
      return { folders: folders(slug) };
    },
  ],
  [/^\/api\/tome\/projects\/([^/]+)\/history\/(.+)$/, () => ({ revisions: [] })],
  [/^\/api\/tome\/projects\/([^/]+)\/revisions\/(.+)$/, () => ({ revisions: [] })],
  [/^\/api\/tome\/projects\/([^/]+)\/template-drift$/, () => ({ drift: [], checked_at: null })],

  // What a space's own views read.
  [/^\/api\/tome\/projects\/([^/]+)\/team$/, () => TEAM],
  [
    /^\/api\/tome\/projects\/([^/]+)\/critical-items$/,
    (match) => {
      const slug = decodeURIComponent(match[1]);
      const scope = [slug, ...descendants(slug)];
      return {
        items: CRITICAL_ITEMS.filter((item) =>
          scope.includes(item.source_project_slug),
        ),
        rollup_project_slugs: scope,
      };
    },
  ],
  [/^\/api\/tome\/projects\/([^/]+)\/ingests$/, () => ({ runs: INGEST_RUNS })],
  [
    /^\/api\/tome\/projects\/([^/]+)\/ingests\/([^/]+)$/,
    (match) => ({
      run: INGEST_RUNS.find((run) => run.id === decodeURIComponent(match[2])) ?? INGEST_RUNS[0],
      pages: [],
      logs: [],
    }),
  ],
  [/^\/api\/tome\/projects\/([^/]+)\/gists\/([^/]+)$/, (match) => ({
    gist: GISTS.find((gist) => gist.id === decodeURIComponent(match[2])) ?? GISTS[0],
  })],
  [/^\/api\/tome\/projects\/([^/]+)\/gists$/, (match) => ({
    gists: GISTS.map((gist) => ({
      ...gist,
      path: `/projects/${decodeURIComponent(match[1])}/tome/gists/${gist.id}`,
    })),
  })],
  [/^\/api\/tome\/projects\/([^/]+)\/glossary$/, () => ({ terms: GLOSSARY_TERMS })],
  [/^\/api\/tome\/projects\/([^/]+)\/edges$/, () => ({ outgoing: [], incoming: [], titles: {} })],
  [/^\/api\/tome\/projects\/([^/]+)\/engagement$/, () => ({ readers: 0, events: [] })],
  [/^\/api\/tome\/projects\/([^/]+)\/feed$/, () => ({ messages: [], total: 0 })],
  [/^\/api\/tome\/projects\/([^/]+)\/issue-trackers$/, () => ({ trackers: [] })],
  [
    /^\/api\/tome\/projects\/([^/]+)\/github-issues$/,
    () => ({
      issues: [],
      availableIssues: [],
      credentialConfigured: false,
      credentialSource: null,
      writeCredentialConfigured: false,
      writeCredentialOwner: null,
      repos: [],
      trackedLabels: [],
      rollupProjectSlugs: [],
      projectRepos: {},
      cache: { source: "prototype", refreshed_at: null },
    }),
  ],
  [
    /^\/api\/tome\/projects\/([^/]+)\/webex-meeting-series$/,
    () => ({
      subscriptions: MEETING_SERIES,
      occurrences: OCCURRENCES,
      candidates: [],
      canEdit: true,
    }),
  ],
  [/^\/api\/tome\/projects\/([^/]+)\/webex-meetings$/, () => ({ meetings: [] })],
  [
    /^\/api\/tome\/projects\/([^/]+)\/children$/,
    (match) => {
      const slug = decodeURIComponent(match[1]);
      const below = descendants(slug);
      return {
        children: below.map(childRow),
        total: below.length,
        withheld: 0,
      };
    },
  ],
  [/^\/api\/tome\/projects\/([^/]+)\/chat\/history$/, () => ({ messages: [] })],
  [/^\/api\/tome\/projects\/([^/]+)\/preflight$/, () => ({ ready: true, checks: [] })],
  [/^\/api\/tome\/assistant-settings$/, () => ({ settings: { enabled: false } })],
  [/^\/api\/tome\/page-templates$/, () => ({ templates: [] })],
  [/^\/api\/tome\/model-config$/, () => ({ configs: [] })],
  [/^\/api\/tome\/mcp$/, () => ({ url: "https://tome.example.com/mcp", tools: [] })],
  [/^\/api\/tome\/myagent\/status$/, () => ({ connected: false })],
  [/^\/api\/tome\/token$/, () => ({ token: null })],
  [/^\/api\/tome\/webex-meeting-series$/, () => ({ candidates: [], complete: true, warnings: [] })],
  [/^\/api\/dynamic-agents\/teams$/, () => ({ teams: [] })],
  [/^\/api\/rooms$/, () => ({ rooms: [] })],
];

/** The envelope the API answers in. */
function reply(data: Json | null, status = 200): Response {
  return new Response(JSON.stringify(data === null ? null : { data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Put the prototype's answers in front of the network.
 *
 * Called once, from the shell, before any screen mounts. Anything the routes
 * above do not recognise is answered empty rather than left to fail: a screen
 * the prototype has no fixtures for should show its own empty state, which is
 * part of the work being shown, instead of an error from a server that does
 * not exist.
 */
export function installMockApi(): void {
  const w = window as unknown as { __tomePrototypeInstalled?: boolean };
  if (w.__tomePrototypeInstalled) return;
  w.__tomePrototypeInstalled = true;

  const real = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(href, window.location.origin);

    // Anything that is not this app's API — fonts, images — still goes out.
    if (!url.pathname.startsWith("/api/")) return real(input as RequestInfo, init);

    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    for (const [pattern, answer] of ROUTES) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      return reply(answer(match, url, { ...init, method }));
    }

    // A stream the prototype cannot produce is better closed than left open.
    if (url.pathname.endsWith("/stream") || url.pathname.endsWith("/events")) {
      return new Response("", { status: 204 });
    }

    return reply({});
  };
}
