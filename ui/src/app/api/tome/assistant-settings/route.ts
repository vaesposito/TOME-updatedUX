import { NextRequest, NextResponse } from "next/server";

import { ApiError, getAuthFromBearerOrSession, requireRbacPermission, withErrorHandler } from "@/lib/api-middleware";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getTomeNativeChatAgentId } from "@/lib/tome/chat-routing";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { readTomeAssistantSettings, saveTomeAssistantSettings } from "@/lib/tome/assistant-settings-store";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isTomeServerEnabled()) throw new ApiError("Not found", 404, "NOT_FOUND");
  const { session } = await getAuthFromBearerOrSession(request);
  if (!session.sub || session.principalType !== "oidc_user" || session.isServiceAccount) {
    throw new ApiError("Interactive user identity required", 403, "TOME_USER_REQUIRED");
  }
  await requireRbacPermission(session, "chat", "invoke");
  return NextResponse.json({
    data: { ...await readTomeAssistantSettings(), agent_id: getTomeNativeChatAgentId() },
  }, { headers: { "Cache-Control": "private, no-store" } });
});

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  if (!isTomeServerEnabled()) throw new ApiError("Not found", 404, "NOT_FOUND");
  const { user, session } = await getAuthFromBearerOrSession(request);
  if (session.principalType !== "oidc_user" || session.isServiceAccount || !(await isTomeAdmin(session))) {
    throw new ApiError("Forbidden", 403, "FORBIDDEN");
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("Invalid JSON body", 400, "BAD_REQUEST");
  }
  const enabled = (body as Record<string, unknown>).tome_assistant_popup_enabled;
  const settings = await saveTomeAssistantSettings(enabled, user.email);
  auditTome({
    action: "tome.assistant.settings.update",
    actor: tomeActorFromAuth({ user, session }),
    projectSlug: "global",
    metadata: { ...settings },
  });
  return NextResponse.json({ data: settings }, { headers: { "Cache-Control": "private, no-store" } });
});
