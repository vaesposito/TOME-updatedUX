import { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-middleware";
import { requireAgentToken, resolveProject } from "@/lib/tome/internal-api";
import { askMyAgentForRun } from "@/lib/tome/myagent-tool";

export const dynamic = "force-dynamic";
export const POST = withErrorHandler(async (
  request: NextRequest, ctx: { params: Promise<{ id: string; runId: string }> },
) => {
  requireAgentToken(request);
  const { id, runId } = await ctx.params;
  const project = await resolveProject(id);
  const body = await request.json().catch(() => ({}));
  return Response.json(await askMyAgentForRun(project, runId, body?.question, "chat"));
});
