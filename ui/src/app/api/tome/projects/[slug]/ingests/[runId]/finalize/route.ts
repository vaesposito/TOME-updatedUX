// Finalize a complete file-level ingest review. Accepted files are promoted;
// rejected files stay in revision history without becoming live.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import {
  fallbackQualityPolicy,
  getArtifactEvaluation,
  insertQualityGateOverride,
} from "@/lib/tome/evaluation-store";
import { summarizeDraftFileReviews } from "@/lib/tome/ingest-review";
import { finalizeDraftFileReview } from "@/lib/tome/ingest-runner";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { getPageStore } from "@/lib/tome/page-store";
import { qualityGateDecision } from "@/lib/tome/rubric-evaluator";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import type { TomeRubricId } from "@/types/tome-evaluation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; runId: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId, project_id: tctx.projectId });
  if (!run) throw new ApiError("Ingest run not found", 404, "RUN_NOT_FOUND");
  if (run.status !== "awaiting_review") {
    throw new ApiError("Run is not awaiting review", 409, "RUN_NOT_AWAITING_REVIEW");
  }
  if (!run.report_id) {
    throw new ApiError("Run has no draft report", 409, "RUN_HAS_NO_DRAFT_REPORT");
  }

  const store = await getPageStore();
  const summary = summarizeDraftFileReviews(
    await store.listDraftPaths(tctx.projectId, run.report_id),
    run.file_reviews,
  );
  if (summary.pendingPaths.length > 0) {
    throw new ApiError(
      `Review every file before finishing (${summary.pendingPaths.length} remaining)`,
      409,
      "FILE_REVIEWS_INCOMPLETE",
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    override_reason?: string;
  };
  // A quality gate controls publication. An all-rejected review publishes
  // nothing, so it does not require a quality override.
  if (summary.acceptedPaths.length > 0) {
    const evaluation = run.quality_evaluation_id
      ? await getArtifactEvaluation(run.quality_evaluation_id)
      : null;
    const policy = {
      ...fallbackQualityPolicy(),
      version: run.quality_policy_version ?? 0,
      mode: run.quality_policy_mode ?? "off",
      allow_steward_override: run.quality_allow_steward_override === true,
      require_human_review: run.quality_require_human_review !== false,
    };
    const gate = qualityGateDecision(policy, evaluation);
    if (!gate.allowed) {
      const reason = body.override_reason?.trim() || "";
      if (!gate.requires_override || reason.length < 10) {
        throw new ApiError(
          gate.requires_override
            ? "Quality gate failed. An override reason of at least 10 characters is required."
            : "Quality gate failed and this policy does not allow an override.",
          409,
          "QUALITY_GATE_BLOCKED",
        );
      }
      const failedRubrics = (evaluation?.rubrics ?? [])
        .filter((rubric) => rubric.enabled && rubric.blocking && rubric.passed !== true)
        .map((rubric) => rubric.id as TomeRubricId);
      await insertQualityGateOverride({
        run_id: runId,
        project_id: tctx.projectId,
        policy_version: policy.version,
        actor: tctx.user.email ?? "unknown",
        reason,
        failed_rubrics: failedRubrics,
      });
      auditTome({
        action: "tome.quality.override",
        actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
        projectSlug: slug,
        metadata: { run_id: runId, reason, failed_rubrics: failedRubrics, policy_version: policy.version },
      });
    }
  }

  const reviewedBy = tctx.user.email ?? "unknown";
  const result = await finalizeDraftFileReview(runId, reviewedBy);
  auditTome({
    action: "tome.ingest.finalize_review",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { run_id: runId, reviewed_by: reviewedBy, ...result },
  });

  return successResponse({ ok: true, ...result });
});
