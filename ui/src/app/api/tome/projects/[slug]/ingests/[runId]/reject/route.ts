// Reject a draft ingest run: tombstones its draft pages, prior live content
// (if any) remains current. Editor-gated, same as approve.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { rejectDraftRun } from "@/lib/tome/ingest-runner";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import { mayViewMyAgentRunEvidence } from "@/lib/projects/myagent-source";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; runId: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId, project_id: tctx.projectId });
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
      "Only the user who authorized this MyAgent evidence or a Tome administrator may reject it.",
      403,
      "MYAGENT_EVIDENCE_PRIVATE",
    );
  }
  if (run.status !== "awaiting_review") {
    throw new ApiError("Run is not awaiting review", 409, "RUN_NOT_AWAITING_REVIEW");
  }
  if ((run.file_reviews?.length ?? 0) > 0) {
    throw new ApiError(
      "A file-level review is in progress. Complete it with Done.",
      409,
      "FILE_REVIEW_IN_PROGRESS",
    );
  }

  const reviewedBy = tctx.user.email ?? "unknown";
  await rejectDraftRun(runId, reviewedBy);

  auditTome({
    action: "tome.ingest.reject",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { run_id: runId, reviewed_by: reviewedBy },
  });

  return successResponse({ ok: true });
});
