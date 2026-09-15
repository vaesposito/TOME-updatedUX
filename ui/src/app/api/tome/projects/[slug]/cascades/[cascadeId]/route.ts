// Status of one BHAG synthesize cascade: the parent synthesize run plus each
// child re-ingest, with project names. Polled by the BHAG run view so the user
// sees which children are queued / running / done.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { getEvidenceBundles } from "@/lib/tome/evaluation-store";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import { mayViewMyAgentRunEvidence } from "@/lib/projects/myagent-source";
import { bundleHasMyAgentEvidence } from "@/lib/tome/evidence-bundle";
import type { ProjectDocument } from "@/types/projects";
import type { IngestRun } from "@/types/tome";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; cascadeId: string }> };

function summarize(
  run: IngestRun,
  name: string,
  slug: string,
  canViewPrivateDetails: boolean,
  viaArea?: string,
) {
  return {
    id: String(run._id),
    project_id: run.project_id,
    name,
    slug,
    role: run.cascade_role ?? null,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at ?? null,
    error: canViewPrivateDetails ? run.error ?? null : null,
    /** Endpoint this run dispatches to — "synthesize" for an Area's own
     * roll-up (shown distinctly from a plain project "ingest") vs "ingest". */
    endpoint: run.dispatch?.endpoint === "/synthesize" ? "synthesize" : "ingest",
    /** Set when this entry was pulled in from a nested Area sub-cascade
     * rather than being a direct child of the top-level cascade — names the
     * Area it belongs to, so the UI can group/label it distinctly. */
    via_area: viaArea ?? null,
  };
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, cascadeId } = await ctx.params;
  const tctx = await loadTomeProject(request, slug); // auth + feature gate
  const viewerSubject = tomeSessionSubject(tctx.session);

  const runs = await getTomeIngestRunsCollection();
  const rows = await runs.find({ cascade_id: cascadeId }).toArray();
  if (rows.length === 0) {
    throw new ApiError("Cascade not found", 404, "CASCADE_NOT_FOUND");
  }

  const parent = rows.find((r) => r.cascade_role === "parent");

  // A BHAG's synthesize can block on whole nested Area sub-cascades (see
  // `blocked_by_cascade_ids`) that live under a DIFFERENT cascade_id — those
  // runs are otherwise invisible to this endpoint since the query above only
  // matches the top-level cascade_id. Recurse into them (breadth-first,
  // visited-guarded) so every descendant run shows up in one flat list.
  const allRows = [...rows];
  const visited = new Set<string>([cascadeId]);
  let frontier = parent?.blocked_by_cascade_ids ?? [];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const subId of frontier) {
      if (visited.has(subId)) continue;
      visited.add(subId);
      const subRows = await runs.find({ cascade_id: subId }).toArray();
      allRows.push(...subRows);
      const subParent = subRows.find((r) => r.cascade_role === "parent");
      if (subParent?.blocked_by_cascade_ids) next.push(...subParent.blocked_by_cascade_ids);
    }
    frontier = next;
  }
  const evidenceBundles = await getEvidenceBundles(
    allRows.flatMap((run) => (run.evidence_bundle_id ? [run.evidence_bundle_id] : [])),
  );
  const canViewPrivateDetails = (run: IngestRun) => {
    const hasPrivateEvidence =
      run.myagent_delegated === true ||
      bundleHasMyAgentEvidence(
        run.evidence_bundle_id ? evidenceBundles.get(run.evidence_bundle_id) : null,
      );
    return (
      !hasPrivateEvidence ||
      mayViewMyAgentRunEvidence(
        run.triggered_by_sub,
        viewerSubject,
        tctx.canManageSteward,
      )
    );
  };

  // Resolve project names + slugs for everything in the cascade in one pass.
  const projects = await getCollection<ProjectDocument>("projects");
  const all = await projects.find({}).project({ slug: 1, title: 1, name: 1 }).toArray();
  const nameById = new Map(
    all.map((p) => [String(p._id), (p.title || p.name || String(p._id)) as string]),
  );
  const slugById = new Map(all.map((p) => [String(p._id), (p.slug || String(p._id)) as string]));

  // Every non-top-level-parent row is a "child" for display purposes: direct
  // skip-level project ingests, a nested Area's own synthesize (labeled via
  // its own project name), and that Area's leaf project ingests (tagged with
  // `via_area` so the UI can show which Area pulled them in).
  const children = allRows
    .filter((r) => r._id !== parent?._id)
    .map((r) => {
      const isNested = r.cascade_id !== cascadeId;
      const viaAreaName = isNested && r.cascade_role === "child"
        ? (nameById.get(allRows.find((x) => x.cascade_id === r.cascade_id && x.cascade_role === "parent")?.project_id ?? "") ?? undefined)
        : undefined;
      return summarize(
        r,
        nameById.get(r.project_id) ?? r.project_id,
        slugById.get(r.project_id) ?? r.project_id,
        canViewPrivateDetails(r),
        viaAreaName,
      );
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return successResponse({
    cascade_id: cascadeId,
    parent: parent
      ? summarize(
          parent,
          nameById.get(parent.project_id) ?? parent.project_id,
          slugById.get(parent.project_id) ?? parent.project_id,
          canViewPrivateDetails(parent),
        )
      : null,
    children,
    counts: {
      total: children.length,
      succeeded: children.filter((c) => c.status === "succeeded").length,
      failed: children.filter((c) => c.status === "failed").length,
      running: children.filter((c) => c.status === "running").length,
      queued: children.filter((c) => c.status === "queued").length,
    },
  });
});
