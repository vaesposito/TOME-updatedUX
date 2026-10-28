// What sits below a BHAG or an Area, and how each of them is doing. Powers
// the "Areas & projects" card on a container's Home.
//
// Read-only, and filtered per caller rather than per entity: reading a BHAG
// does not grant reading everything beneath it, so two people opening the
// same BHAG can legitimately see different children. The count of the ones
// held back is returned so the card can say the list is partial instead of
// quietly describing a smaller portfolio than exists.
//
// The hierarchy itself comes from resolveEntitySubtree, which the digest and
// the decisions rollup already use — the BHAG to Area to Project closure is
// subtle enough that a fourth implementation of it would be a bug waiting to
// happen. What this route adds is the operational state the digest has no
// reason to know: how much each child has been written, when it was last
// touched, and whether an ingest is running right now.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { sessionSub } from "@/lib/tome/agent-proxy";
import { iso, stateByProjectId } from "@/lib/tome/child-state.server";
import { filterReadableTomeProjects } from "@/lib/tome/access";
import { resolveEntitySubtree, sortHierarchy } from "@/lib/tome/entity-hierarchy";
import { loadTomeProject } from "@/lib/tome/tome-api";
import type { ProjectDocument } from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * How many children cross the wire.
 *
 * A BHAG with more than this is a portfolio rather than a card, and the card
 * says so and sends the reader to the list that is built for it. The cap is
 * on the response, not on the counting, so the totals stay true.
 */
const CHILD_LIMIT = 24;

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const { project, session, canManageSteward } = await loadTomeProject(request, slug);

  const subtree = await resolveEntitySubtree(project);
  const descendants = subtree.filter((node) => node.slug !== project.slug);
  if (descendants.length === 0) {
    return successResponse({ children: [], total: 0, withheld: 0 });
  }

  const projects = await getCollection<ProjectDocument>("projects");
  const rows = await projects
    .find({ slug: { $in: descendants.map((node) => node.slug) } })
    .project<ProjectDocument>({ slug: 1, title: 1, name: 1, type: 1, labels: 1, status: 1 })
    .toArray();

  const readable = await filterReadableTomeProjects(sessionSub(session), rows, {
    isAdmin: canManageSteward,
  });
  const bySlug = new Map(readable.map((row) => [row.slug, row] as const));
  const state = await stateByProjectId(readable.map((row) => String(row._id)));

  // Depth-first, so an Area's own projects follow it rather than being
  // scattered through a list of everything. The entity itself is sorted with
  // its descendants and dropped afterwards: it is the root they hang from,
  // and without it an Area has no reachable parent and the walk falls back to
  // listing whatever it could not place.
  const ordered = sortHierarchy(
    subtree.filter(
      (node) => node.slug === project.slug || bySlug.has(node.slug),
    ),
  ).filter((node) => node.slug !== project.slug);

  return successResponse({
    children: ordered.slice(0, CHILD_LIMIT).map((node) => {
      const row = bySlug.get(node.slug);
      const own = row ? state.get(String(row._id)) : undefined;
      return {
        slug: node.slug,
        title: node.title,
        type: node.type,
        ...(node.parent_slug && node.parent_slug !== project.slug
          ? { parent_slug: node.parent_slug }
          : {}),
        ...(row?.status ? { status: row.status } : {}),
        page_count: own?.page_count ?? 0,
        last_ingested_at: own?.last_ingested_at ?? null,
        last_edited_at: own?.last_edited_at ?? null,
        ingesting: own?.ingesting ?? null,
      };
    }),
    total: ordered.length,
    /** Descendants this caller may not read, so the card can say it is partial. */
    withheld: descendants.length - ordered.length,
  });
});
