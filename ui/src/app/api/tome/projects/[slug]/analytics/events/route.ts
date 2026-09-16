import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { hashTomeSubject, tomeActorFromAuth } from "@/lib/tome/audit";
import { getTomeUsageEventsCollection } from "@/lib/tome/mongo-collections";
import { safePagePath } from "@/lib/tome/page-store";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { TOME_USAGE_VIEW_KINDS, type TomeUsageViewKind } from "@/types/tome";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

function validateId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new ApiError(`\`${field}\` must be an 8-128 character identifier`, 400, "BAD_REQUEST");
  }
  return value;
}

function validateViewKind(value: unknown): TomeUsageViewKind {
  if (typeof value !== "string" || !(TOME_USAGE_VIEW_KINDS as readonly string[]).includes(value)) {
    throw new ApiError("Invalid `viewKind`", 400, "BAD_REQUEST");
  }
  return value as TomeUsageViewKind;
}

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const body = (await request.json().catch(() => ({}))) as {
    eventId?: unknown;
    analyticsSessionId?: unknown;
    viewKind?: unknown;
    pagePath?: unknown;
  };

  const eventId = validateId(body.eventId, "eventId");
  const analyticsSessionId = validateId(body.analyticsSessionId, "analyticsSessionId");
  const viewKind = validateViewKind(body.viewKind);
  let pagePath: string | undefined;
  if (viewKind === "page" || viewKind === "pageHistory") {
    if (typeof body.pagePath !== "string" || body.pagePath.length > 500) {
      throw new ApiError("A valid `pagePath` is required for page views", 400, "BAD_REQUEST");
    }
    try {
      pagePath = safePagePath(body.pagePath);
    } catch {
      throw new ApiError("Invalid `pagePath`", 400, "BAD_REQUEST");
    }
  }

  const actor = tomeActorFromAuth({ user: tctx.user, session: tctx.session });
  const events = await getTomeUsageEventsCollection();
  await events.updateOne(
    { event_id: eventId },
    {
      $setOnInsert: {
        event_id: eventId,
        event: "view",
        occurred_at: new Date(),
        subject_hash: hashTomeSubject(actor.id),
        project_id: tctx.projectId,
        project_slug: tctx.project.slug,
        analytics_session_id: analyticsSessionId,
        view_kind: viewKind,
        ...(pagePath ? { page_path: pagePath } : {}),
      },
    },
    { upsert: true },
  );

  return successResponse({ recorded: true }, 202);
});
