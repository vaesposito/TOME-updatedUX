// Revision history for one page (newest first) — summaries for the diff/history
// view. Revisions carry `report_id` when produced by an ingest, so an ingest's
// changes are attributable.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getPageStore } from "@/lib/tome/page-store";
import { currentLiveRevision } from "@/lib/tome/revision-status";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import { mayViewMyAgentRunEvidence } from "@/lib/projects/myagent-source";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const { projectId } = tctx;
  const pagePath = path.join("/");

  const store = await getPageStore();
  const revisions = await store.pageHistory(projectId, pagePath);
  const current = currentLiveRevision(revisions);

  // Do not disclose non-live revision ids for another user's delegated
  // evidence: the single-revision endpoint can otherwise turn an ID from
  // history into the raw body. This includes a rejected draft: rejecting a
  // report removes it from normal reads, but must not turn its private source
  // material into shared history. Only an explicit approval makes a MyAgent
  // report revision live and shareable.
  const nonLiveReportIds = [...new Set(
    revisions
      .filter(
        (revision) =>
          (revision.status === "draft" || revision.status === "rejected") &&
          revision.report_id,
      )
      .map((revision) => revision.report_id!),
  )];
  const privateMyAgentReportIds = new Set<string>();
  if (nonLiveReportIds.length > 0) {
    const runs = await getTomeIngestRunsCollection();
    const delegatedRuns = await runs.find({
      project_id: projectId,
      report_id: { $in: nonLiveReportIds },
      myagent_evidence_received: true,
    }).toArray();
    for (const run of delegatedRuns) {
      if (
        !mayViewMyAgentRunEvidence(
          run.triggered_by_sub,
          tomeSessionSubject(tctx.session),
          tctx.canManageSteward,
        ) && run.report_id
      ) {
        privateMyAgentReportIds.add(run.report_id);
      }
    }
  }

  const summaries = revisions
    .filter(
      (revision) =>
        !(
          (revision.status === "draft" || revision.status === "rejected") &&
          revision.report_id &&
          privateMyAgentReportIds.has(revision.report_id)
        ),
    )
    .map((r) => ({
    id: String(r._id),
    author: r.author,
    message: r.message,
    created_at: r.created_at,
    report_id: r.report_id ?? null,
    status: r.status ?? "live",
    deleted: Boolean(r.deleted),
    reverted_from: r.reverted_from ?? null,
    draft_created_at: r.draft_created_at ?? null,
    reviewed_at: r.reviewed_at ?? null,
    reviewed_by: r.reviewed_by ?? null,
    review_outcome: r.review_outcome ?? null,
    }));

  return successResponse({
    path: pagePath,
    current_revision_id: current?._id ? String(current._id) : null,
    revisions: summaries,
  });
});
