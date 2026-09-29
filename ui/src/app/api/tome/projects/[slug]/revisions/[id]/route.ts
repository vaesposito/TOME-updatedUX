// A single page revision's body — used by the diff view to fetch the two sides.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { getPageStore } from "@/lib/tome/page-store";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import { mayViewMyAgentRunEvidence } from "@/lib/projects/myagent-source";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, id } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const { projectId } = tctx;

  const store = await getPageStore();
  const rev = await store.readRevision(projectId, id);
  if (!rev) {
    throw new ApiError("Revision not found", 404, "REVISION_NOT_FOUND");
  }
  // A MyAgent-influenced revision remains private until it is explicitly
  // approved into the live wiki. A rejected revision is not live merely
  // because its draft status was restamped; it must remain inaccessible to
  // other collaborators just like a pending draft.
  if ((rev.status === "draft" || rev.status === "rejected") && rev.report_id) {
    const run = await getTomeIngestRunsCollection().then((runs) =>
      runs.findOne({
        project_id: projectId,
        report_id: rev.report_id,
        myagent_evidence_received: true,
      }),
    );
    if (
      run &&
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
  }

  return successResponse({
    id: String(rev._id),
    path: rev.path,
    author: rev.author,
    message: rev.message,
    created_at: rev.created_at,
    deleted: Boolean(rev.deleted),
    body: rev.deleted ? "" : (rev.markdown ?? ""),
  });
});
