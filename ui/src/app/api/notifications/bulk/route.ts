// POST /api/notifications/bulk — mark a selection read/unread or
// dismissed/restored. One endpoint because the inbox toolbar acts on the same
// selection either way.

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { updateNotificationStates } from "@/lib/notification-inbox.server";

export const dynamic = "force-dynamic";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const subject = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!subject) {
    throw new ApiError("Authentication required", 401, "NO_TOKEN");
  }

  const body = (await request.json().catch(() => ({}))) as {
    ids?: unknown;
    read?: unknown;
    dismissed?: unknown;
  };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) {
    throw new ApiError("`ids` (string[]) is required", 400, "BAD_REQUEST");
  }
  if (typeof body.read !== "boolean" && typeof body.dismissed !== "boolean") {
    throw new ApiError(
      "One of `read` or `dismissed` (boolean) is required",
      400,
      "BAD_REQUEST",
    );
  }

  const updated = await updateNotificationStates(subject, ids, {
    ...(typeof body.read === "boolean" ? { read: body.read } : {}),
    ...(typeof body.dismissed === "boolean" ? { dismissed: body.dismissed } : {}),
  });
  return successResponse({ updated });
});
