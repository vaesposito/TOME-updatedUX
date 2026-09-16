// The diff bundle for one run: for each changed path, the body before the run
// touched it and the body the run wrote, so a reviewer (or anyone browsing
// history later) can see what a run changed without reading its raw log.
// Works for any run — a draft awaiting review, or one long since terminal.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { getPageStore } from "@/lib/tome/page-store";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { reviewDraftFile } from "@/lib/tome/ingest-runner";
import type { IngestFileReviewDecision } from "@/types/tome";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; runId: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const { projectId } = tctx;

  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId, project_id: projectId });
  if (!run) throw new ApiError("Ingest run not found", 404, "RUN_NOT_FOUND");
  if (!run.report_id) {
    return successResponse({
      pages: [],
      status: run.status,
      reviewMode: tctx.project.review_mode ?? "stable_only",
    });
  }

  const store = await getPageStore();
  // A review is a diff for the whole ingest, not merely its pending subset.
  // In stable-only mode some dynamic files publish immediately; they still
  // belong in the changed-file list, clearly marked as not requiring a
  // decision, so reviewers never get a misleading one-file view of a run.
  const [paths, draftPaths] = await Promise.all([
    store.listTouchedPaths(projectId, run.report_id),
    run.status === "awaiting_review"
      ? store.listDraftPaths(projectId, run.report_id)
      : Promise.resolve([]),
  ]);
  const decisionRequired = new Set(draftPaths);
  const decisions = new Map((run.file_reviews ?? []).map((review) => [review.path, review]));

  const pages = await Promise.all(
    [...paths].sort().map(async (path) => {
      const history = await store.pageHistory(projectId, path);
      // Newest first. The run's own write: the newest revision for this report.
      const runRev = history.find((r) => r.report_id === run.report_id);
      // Compare with what was actually visible immediately before this report
      // first touched the path. A report may write the same page more than
      // once, and revisions from rejected or still-pending reports were never
      // live wiki content.
      let oldestRunRevisionIdx = -1;
      for (let idx = 0; idx < history.length; idx += 1) {
        if (history[idx].report_id === run.report_id) oldestRunRevisionIdx = idx;
      }
      const priorLiveRev = history
        .slice(oldestRunRevisionIdx + 1)
        .find((revision) => revision.status === undefined || revision.status === "live");
      const isNewPage = !priorLiveRev || Boolean(priorLiveRev.deleted);
      const recorded = decisions.get(path);
      const historicalDecision = !recorded && run.status !== "awaiting_review"
        ? runRev?.status === "rejected"
          ? "reject"
          : runRev && runRev.status !== "draft"
            ? "accept"
            : undefined
        : undefined;
      return {
        path,
        oldBody: priorLiveRev && !priorLiveRev.deleted ? priorLiveRev.markdown ?? "" : "",
        newBody: runRev && !runRev.deleted ? runRev.markdown ?? "" : "",
        isNewPage,
        requiresDecision: decisionRequired.has(path),
        decision: recorded?.decision ?? historicalDecision ?? null,
        reviewedBy: recorded?.reviewed_by ?? null,
        reviewedAt: recorded?.reviewed_at ?? null,
      };
    }),
  );

  return successResponse({
    pages,
    status: run.status,
    reviewMode: tctx.project.review_mode ?? "stable_only",
  });
});

export const PATCH = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const body = (await request.json().catch(() => ({}))) as {
    path?: unknown;
    decision?: unknown;
  };
  const path = typeof body.path === "string" ? body.path : "";
  const decision = body.decision as IngestFileReviewDecision;
  if (!path || (decision !== "accept" && decision !== "reject")) {
    throw new ApiError(
      "`path` and a decision of `accept` or `reject` are required",
      400,
      "INVALID_FILE_REVIEW",
    );
  }

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
  const draftPaths = await store.listDraftPaths(tctx.projectId, run.report_id);
  if (!draftPaths.includes(path)) {
    throw new ApiError("File is not part of this pending draft", 400, "DRAFT_FILE_NOT_FOUND");
  }

  const reviewedBy = tctx.user.email ?? "unknown";
  await reviewDraftFile(runId, path, decision, reviewedBy);
  auditTome({
    action: "tome.ingest.file_review",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    page: path,
    metadata: { run_id: runId, decision, reviewed_by: reviewedBy },
  });

  return successResponse({ path, decision, reviewedBy });
});
