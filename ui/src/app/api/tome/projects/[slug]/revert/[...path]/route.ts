// Revert a page to a prior revision's body — a new append-only write, not a
// destructive rewrite. Body = { revisionId }. Editor-gated; blocked while the
// project is locked, same as a manual edit. Sibling to pages/[...path] and
// history/[...path] (a route nested under pages/[...path]/revert would put a
// static segment after a catch-all, which Next.js rejects).

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor, guardNotLocked } from "@/lib/tome/tome-api";
import { AGENT_IDENTITIES } from "@/lib/tome/agent-identities";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getPageStore } from "@/lib/tome/page-store";
import { PageNotFoundError } from "@/lib/tome/mongo-page-store";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import { mayViewMyAgentRunEvidence } from "@/lib/projects/myagent-source";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, path } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  await guardNotLocked(tctx.projectId, tctx.project.locked ?? false);
  const pagePath = path.join("/");

  const body = (await request.json().catch(() => ({}))) as { revisionId?: string };
  if (typeof body.revisionId !== "string" || !body.revisionId) {
    throw new ApiError("`revisionId` (string) is required", 400, "BAD_REQUEST");
  }

  const store = await getPageStore();
  // `revertPage` copies a revision body into a new live write. Do not let a
  // collaborator use an ID from a cached history response to publish another
  // user's private delegated evidence after its report was drafted or
  // rejected. The report review endpoints use this same owner/admin boundary.
  const target = await store.readRevision(tctx.projectId, body.revisionId);
  if (!target || target.path !== pagePath) {
    throw new ApiError("Revision not found", 404, "REVISION_NOT_FOUND");
  }
  if (
    (target.status === "draft" || target.status === "rejected") &&
    target.report_id
  ) {
    const run = await getTomeIngestRunsCollection().then((runs) =>
      runs.findOne({
        project_id: tctx.projectId,
        report_id: target.report_id,
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
        "This revision contains private MyAgent evidence and is available only to the user who authorized it or a Tome administrator.",
        403,
        "MYAGENT_EVIDENCE_PRIVATE",
      );
    }
  }
  try {
    await store.revertPage(tctx.projectId, pagePath, body.revisionId, {
      author: tctx.user.email ?? AGENT_IDENTITIES.default,
      origin: "manual",
    });
  } catch (err) {
    if (err instanceof PageNotFoundError) {
      throw new ApiError("Revision not found", 404, "REVISION_NOT_FOUND");
    }
    throw err;
  }

  auditTome({
    action: "tome.page.revert",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    page: pagePath,
    metadata: { revision_id: body.revisionId },
  });

  return successResponse({ ok: true, path: pagePath });
});
