import { NextRequest } from "next/server";
import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { sessionSub } from "@/lib/tome/agent-proxy";
import { resolveWebexRoomExecution } from "@/lib/tome/webex-room-execution";

export const dynamic = "force-dynamic";

/** Selected-space removal permissions, not ingestion permissions. */
export const GET = withErrorHandler(async (request: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const project = await loadTomeProject(request, slug);
  const { checks } = await resolveWebexRoomExecution({ sources: project.project.sources ?? {},
    subject: sessionSub(project.session), userEmail: project.user.email, purpose: "edit" });
  return successResponse({ rooms: checks });
});
