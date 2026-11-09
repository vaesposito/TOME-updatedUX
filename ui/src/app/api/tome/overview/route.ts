// Everything the reader can see, in one answer: the digest across all their
// spaces, plus the hierarchy those spaces form.
//
// The per-entity summary is rooted at an entity and walks down from it. There
// is nothing above a BHAG to root this one at, so the scope is supplied
// instead — the set of spaces the caller may read — and the same row reading,
// sectioning and per-entity tallying runs over it. One implementation, so the
// workspace overview can never disagree with a space's own.
//
// Access is the catalogue's, not an entity's: listReadableTomeProjects is the
// same gate the projects list uses, so this route shows exactly the spaces
// that list would and nothing more. Rows are filtered again to the caller's
// own notification audience inside getEntitySummary.

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { listReadableTomeProjects } from "@/lib/tome/access";
import { sessionSub } from "@/lib/tome/agent-proxy";
import { childRollupFacts } from "@/lib/tome/child-rollup";
import { stateByProjectId } from "@/lib/tome/child-state.server";
import { isTomeAdmin, type TomeAdminSession } from "@/lib/rbac/tome-admin";
import { getEntitySummary } from "@/lib/tome/entity-summary.server";
import { sortHierarchy } from "@/lib/tome/entity-hierarchy";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";
import type { ProjectDocument, ProjectType } from "@/types/projects";
import type { TomeSummaryEntity } from "@/types/tome-summary";

export const dynamic = "force-dynamic";

/**
 * How many spaces cross the wire.
 *
 * Matches the per-container card. Past this the overview says the list is
 * partial and sends the reader to the Projects tab, which is built for a
 * catalogue rather than a card.
 */
const SPACE_LIMIT = 24;

/** The tier above, as the hierarchy records it on the document's labels. */
function parentOf(project: ProjectDocument): string | undefined {
  const labels = project.labels ?? {};
  const first = (values: unknown): string | undefined => {
    if (!Array.isArray(values)) return undefined;
    const found = values.find(
      (value) => typeof value === "string" && value.trim(),
    );
    return typeof found === "string" ? found.trim() : undefined;
  };
  // An Area names its BHAG; a Project names its Area, or its BHAG when it
  // hangs straight off one.
  return project.type === "area"
    ? first(labels.initiatives)
    : (first(labels.areas) ?? first(labels.initiatives));
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }
  const { user, session } = await getAuthFromBearerOrSession(request);
  requireInteractiveTomePrincipal(session);

  const subject = sessionSub(session);
  if (!subject) {
    throw new ApiError(
      "Your session has expired. Please sign in again.",
      401,
      "NO_TOKEN",
    );
  }

  // Matched to the projects list: a bearer session does not always carry
  // session.user, so the email is folded in before the admin check.
  const adminSession = (session ?? {}) as TomeAdminSession;
  const isAdmin = await isTomeAdmin({
    ...adminSession,
    user: { ...adminSession.user, email: user.email ?? adminSession.user?.email },
  });
  const readable = await listReadableTomeProjects(subject, { isAdmin });

  const entities: TomeSummaryEntity[] = readable.map((project) => {
    const parent = parentOf(project);
    return {
      slug: project.slug,
      title: project.title ?? project.name ?? project.slug,
      type: (project.type ?? "project") as ProjectType,
      ...(parent ? { parent_slug: parent } : {}),
    };
  });

  // A reader with nothing shared with them still gets a well-formed answer,
  // so the overview can say so rather than failing.
  if (entities.length === 0) {
    return successResponse({
      summary: null,
      spaces: [],
      total: 0,
      withheld: 0,
    });
  }

  const summary = await getEntitySummary({
    // Stands in only where a row has no space of its own to name. Nothing is
    // resolved from it: the scope below is what decides which rows are read.
    entity: {
      slug: "",
      title: "TOME",
      type: "bhag",
      labels: {},
    } as ProjectDocument,
    principal: { subject, email: user.email ?? "" },
    scope: "all",
    rows: 50,
    entities,
  });

  // Depth-first, so an Area's own projects follow it. A space whose parent is
  // not in the readable set is sorted as a root of its own rather than being
  // dropped: it was shared, and hiding it because its BHAG was not would
  // describe a smaller portfolio than the reader actually has.
  const reachable = new Set(entities.map((entry) => entry.slug));
  const ordered = sortHierarchy(
    entities.map((entry) => ({
      ...entry,
      ...(entry.parent_slug && reachable.has(entry.parent_slug)
        ? { parent_slug: entry.parent_slug }
        : {}),
    })),
  );

  const bySlug = new Map(readable.map((row) => [row.slug, row] as const));
  const state = await stateByProjectId(
    readable.map((row) => String(row._id)),
  );

  return successResponse({
    summary,
    spaces: ordered.slice(0, SPACE_LIMIT).map((node) => {
      const row = bySlug.get(node.slug);
      const own = row ? state.get(String(row._id)) : undefined;
      return {
        slug: node.slug,
        title: node.title,
        type: node.type,
        ...(node.parent_slug ? { parent_slug: node.parent_slug } : {}),
        ...(row?.status ? { status: row.status } : {}),
        page_count: own?.page_count ?? 0,
        last_ingested_at: own?.last_ingested_at ?? null,
        last_edited_at: own?.last_edited_at ?? null,
        ingesting: own?.ingesting ?? null,
        ...childRollupFacts(row),
      };
    }),
    total: ordered.length,
    withheld: Math.max(0, ordered.length - SPACE_LIMIT),
  });
});
