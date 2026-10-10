// List ingest runs for a project (newest first) — run summaries for the
// Ingest history list.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { getEvidenceBundles } from "@/lib/tome/evaluation-store";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import {
  mayViewMyAgentRunEvidence,
} from "@/lib/projects/myagent-source";
import { bundleHasMyAgentEvidence } from "@/lib/tome/evidence-bundle";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const { projectId } = tctx;

  const runs = await getTomeIngestRunsCollection();
  const rows = await runs
    .find({ project_id: projectId })
    .sort({ started_at: -1 })
    .limit(50)
    .toArray();
  const evidenceBundles = await getEvidenceBundles(
    rows.flatMap((run) => (run.evidence_bundle_id ? [run.evidence_bundle_id] : [])),
  );

  const viewerSubject = tomeSessionSubject(tctx.session);
  const summaries = rows.map((r) => {
    const privateDetailsRestricted =
      (r.myagent_delegated === true ||
        bundleHasMyAgentEvidence(
          r.evidence_bundle_id ? evidenceBundles.get(r.evidence_bundle_id) : null,
        )) &&
      !mayViewMyAgentRunEvidence(
        r.triggered_by_sub,
        viewerSubject,
        tctx.canManageSteward,
      );
    return {
      id: String(r._id),
      status: r.status,
      greenfield: r.greenfield,
      started_at: r.started_at,
      finished_at: r.finished_at ?? null,
      log_lines: privateDetailsRestricted ? 0 : r.log?.length ?? 0,
      error: privateDetailsRestricted ? null : r.error ?? null,
      interrupted: r.interrupted === true,
      review_deadline: r.review_deadline ?? null,
      review_outcome: r.review_outcome ?? null,
      reviewed_by: r.reviewed_by ?? null,
      report_id: r.report_id ?? null,
      myagent_evidence_received:
        r.myagent_evidence_received === true && !privateDetailsRestricted,
      review_access_restricted:
        r.myagent_evidence_received === true && privateDetailsRestricted,
    };
  });

  return successResponse({ runs: summaries });
});
