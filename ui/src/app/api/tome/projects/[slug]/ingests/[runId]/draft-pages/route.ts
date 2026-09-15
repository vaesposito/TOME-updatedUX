// Paths with a pending draft revision for a run awaiting review — the diff
// list a reviewer sees before approving/rejecting.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getPageStore } from "@/lib/tome/page-store";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import { mayViewMyAgentRunEvidence } from "@/lib/projects/myagent-source";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; runId: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const { projectId } = tctx;

  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId, project_id: projectId });
  if (!run) throw new ApiError("Ingest run not found", 404, "RUN_NOT_FOUND");
  if (
    run.myagent_evidence_received === true &&
    !mayViewMyAgentRunEvidence(
      run.triggered_by_sub,
      tomeSessionSubject(tctx.session),
      tctx.canManageSteward,
    )
  ) {
    throw new ApiError(
      "This draft contains private MyAgent evidence and is available only to the user who authorized it or a Tome administrator.",
      403,
      "MYAGENT_EVIDENCE_PRIVATE",
    );
  }
  if (!run.report_id) return successResponse({ paths: [] });

  const store = await getPageStore();
  const paths = await store.listDraftPaths(projectId, run.report_id);
  return successResponse({ paths: paths.sort() });
});
