// Kick an ingest run. POST { seed? } → { runId }. The agent stream is driven
// in the background; the browser polls the run for the live log.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { tomeSessionSubject } from "@/lib/tome/data-steward";
import { startIngestRun, IngestInProgressError } from "@/lib/tome/ingest-runner";
import { isMyAgentInteractiveBrowserIngest } from "@/lib/tome/myagent-interactive";
import {
  prefetchManualWebexMeetingTranscripts,
  type ManualWebexMeetingSelection,
} from "@/lib/tome/webex-meeting-series";
import { isSynthesizedType } from "@/types/projects";
import { normalizeMyAgentConnectors } from "@/lib/projects/myagent-source";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  // A BHAG/Area processes its direct sources as part of the child-wiki
  // synthesis. Route those runs through the dedicated /synthesize endpoint.
  if (isSynthesizedType(tctx.project.type)) {
    throw new ApiError(
      "BHAG and Area sources are processed through synthesis. Use synthesis instead.",
      400,
      "USE_SYNTHESIS",
    );
  }

  if (!process.env.TOME_AGENT_URL) {
    throw new ApiError(
      "Tome agent is not configured (set TOME_AGENT_URL).",
      503,
      "AGENT_NOT_CONFIGURED",
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    seed?: string;
    mode?: "full" | "quick";
    webexMeetings?: ManualWebexMeetingSelection[];
    sourceScope?: "project" | "webex_meetings";
    seedStablePages?: boolean;
    skipReview?: boolean;
    myAgentSources?: unknown;
  };

  if (body.sourceScope && !["project", "webex_meetings"].includes(body.sourceScope)) {
    throw new ApiError("Invalid ingest source scope", 400, "BAD_REQUEST");
  }
  if (body.sourceScope === "webex_meetings" && !body.webexMeetings?.length) {
    throw new ApiError(
      "Select at least one Webex meeting for a meeting-only ingest.",
      400,
      "WEBEX_MEETING_REQUIRED",
    );
  }

  try {
    const webexMeetings = body.webexMeetings?.length
      ? await prefetchManualWebexMeetingTranscripts(
          tomeSessionSubject(tctx.session),
          body.webexMeetings,
        )
      : undefined;
    const { runId } = await startIngestRun(tctx, {
      seed: body.seed ?? null,
      myAgentSources: body.myAgentSources === undefined ? undefined : normalizeMyAgentConnectors(body.myAgentSources),
      mode: body.mode,
      webexMeetings,
      sourceScope: body.sourceScope,
      seedStablePages: body.seedStablePages,
      skipReview: body.skipReview,
      // A valid session alone is insufficient: MCP can forward that cookie.
      // Only the first-party UI's explicit, same-origin action may delegate a
      // MyAgent Webex request for this run.
      myAgentInteractiveAuthorized: isMyAgentInteractiveBrowserIngest(request, tctx.session),
    });
    auditTome({
      action: "tome.ingest.trigger",
      actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
      projectSlug: slug,
      metadata: { run_id: runId, seeded: Boolean(body.seed), mode: body.mode ?? "full" },
    });
    return successResponse({ runId });
  } catch (e) {
    if (e instanceof IngestInProgressError) {
      throw new ApiError(e.message, 409, "INGEST_IN_PROGRESS");
    }
    throw e;
  }
});
