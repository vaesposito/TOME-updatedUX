// GET /api/notifications/inbox — the full notification page: rows, facet
// counts, tab totals and the caller's preferences in one round trip.

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getNotificationInbox } from "@/lib/notification-inbox.server";
import {
  NOTIFICATION_TYPE_FACETS,
  type NotificationAction,
  type NotificationInboxFilter,
  type NotificationInboxTab,
} from "@/types/in-app-notification";

export const dynamic = "force-dynamic";

const TABS: readonly NotificationInboxTab[] = ["unread", "all", "dismissed"];
const ACTIONS = new Set<string>(NOTIFICATION_TYPE_FACETS.map((facet) => facet.action));

function parseTab(value: string | null): NotificationInboxTab {
  return TABS.includes(value as NotificationInboxTab)
    ? (value as NotificationInboxTab)
    : "unread";
}

/**
 * The filter dimensions combine, so each arrives as its own parameter.
 * Unrecognised values are dropped rather than rejected: a stale bookmark
 * should still open the inbox, just with less narrowing than it asked for.
 */
function parseFilter(params: URLSearchParams): NotificationInboxFilter {
  const entity = params.get("entity")?.trim();
  const actions = (params.get("types") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => ACTIONS.has(value)) as NotificationAction[];

  const origin = params.get("origin");

  return {
    ...(entity ? { entity } : {}),
    actions: [...new Set(actions)],
    important: params.get("important") === "1",
    tagged: params.get("tagged") === "1",
    origin: origin === "tome" || origin === "platform" ? origin : null,
  };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  const subject = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!subject) {
    throw new ApiError("Authentication required", 401, "NO_TOKEN");
  }

  const params = new URL(request.url).searchParams;
  const limit = Number.parseInt(params.get("limit") ?? "", 10);

  return successResponse(
    await getNotificationInbox({ subject, email: user.email ?? "" }, {
      tab: parseTab(params.get("tab")),
      filter: parseFilter(params),
      ...(Number.isFinite(limit) ? { limit } : {}),
    }),
  );
});
