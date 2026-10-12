// GET/PATCH /api/notifications/preferences — the set of muted entities, per
// user.

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  getNotificationPreferences,
  setEntityMuted,
} from "@/lib/notification-preferences.server";

export const dynamic = "force-dynamic";

// Preferences live in `user_settings`, which is keyed by email.
async function requireEmail(request: NextRequest): Promise<string> {
  const { user } = await getAuthFromBearerOrSession(request);
  const email = user.email?.trim();
  if (!email) {
    throw new ApiError("Authentication required", 401, "NO_TOKEN");
  }
  return email;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const email = await requireEmail(request);
  return successResponse(await getNotificationPreferences(email));
});

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const email = await requireEmail(request);
  const body = (await request.json().catch(() => ({}))) as {
    mute_entity_slugs?: unknown;
    muted?: unknown;
  };

  const slugs = Array.isArray(body.mute_entity_slugs)
    ? body.mute_entity_slugs.filter((s): s is string => typeof s === "string")
    : [];
  if (slugs.length > 0) {
    return successResponse(
      await setEntityMuted(email, slugs, body.muted !== false),
    );
  }

  throw new ApiError(
    "Provide `mute_entity_slugs` (string[])",
    400,
    "BAD_REQUEST",
  );
});
