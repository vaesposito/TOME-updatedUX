import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import {
  customTomeTrackerLabel,
  materializeTomeIssueLabels,
} from "@/lib/tome/issue-filter-views";
import {
  addTomeCustomIssueTracker,
  listTomeTrackedIssueLabels,
  readTomeIssueLabelSettings,
} from "@/lib/tome/issue-tracker-store";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const project = await loadTomeProject(request, slug);
  const trackers = await listTomeTrackedIssueLabels([project.projectId]);
  return successResponse({ trackers });
});

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const project = await loadTomeProject(request, slug);
  requireTomeEditor(project);
  const settings = await readTomeIssueLabelSettings();
  const body = await request.json().catch(() => null) as { suffix?: unknown } | null;
  const label = typeof body?.suffix === "string"
    ? customTomeTrackerLabel(body.suffix)
    : null;
  const configuredLabels = materializeTomeIssueLabels(settings, settings.legacy_labels);
  if (!label || configuredLabels.some((tracked) =>
    tracked.label === label || tracked.aliases?.includes(label),
  )) {
    throw new ApiError("Use lowercase letters, numbers, and hyphens.", 400, "INVALID_TOME_TRACKER_LABEL");
  }
  await addTomeCustomIssueTracker(project.projectId, label);
  return successResponse({ trackers: await listTomeTrackedIssueLabels([project.projectId]) });
});
