// The inbox's "Webex" tab: GET every watched entity with its Webex delivery
// rule, PATCH one rule. One entity per request, because each row in the tab
// is saved on its own as the reader changes it.

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import {
  filterReadableTomeProjects,
  isTomeAdminSubject,
} from "@/lib/tome/access";
import {
  isValidTimezone,
  listWebexDeliveryRules,
  setWebexDeliveryRule,
} from "@/lib/tome/webex-delivery.server";
import {
  listWebexDeliverySpaces,
  webexDeliveryCapability,
} from "@/lib/tome/webex-notifier.server";
import type { ProjectDocument } from "@/types/projects";
import type {
  WebexDeliveryCadence,
  WebexDeliveryDestination,
  WebexDeliverySettings,
} from "@/types/webex-delivery";

export const dynamic = "force-dynamic";

const DESTINATIONS: readonly WebexDeliveryDestination[] = [
  "off",
  "direct",
  "space",
];
const CADENCES: readonly WebexDeliveryCadence[] = [
  "immediate",
  "daily",
  "weekly",
];

async function requireSubject(request: NextRequest) {
  const { user, session } = await getAuthFromBearerOrSession(request);
  const subject = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!subject) {
    throw new ApiError("Authentication required", 401, "NO_TOKEN");
  }
  return { subject, email: user.email ?? "" };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { subject } = await requireSubject(request);
  const settings: WebexDeliverySettings = {
    capability: webexDeliveryCapability(),
    rules: await listWebexDeliveryRules(subject),
  };
  return successResponse(settings);
});

/**
 * The spaces that could receive a rule.
 *
 * A subresource of this route rather than a route of its own because it is
 * only ever read while editing a rule, and because it is the bot's list —
 * nothing here is specific to the caller beyond their being allowed to ask.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  await requireSubject(request);
  const url = new URL(request.url);
  if (url.searchParams.get("action") !== "spaces") {
    throw new ApiError("Unsupported action", 400, "BAD_REQUEST");
  }
  const query = url.searchParams.get("q")?.trim();
  return successResponse({
    spaces: await listWebexDeliverySpaces(query ? { query } : {}),
  });
});

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const { subject, email } = await requireSubject(request);
  const body = (await request.json().catch(() => null)) as {
    entity_slug?: unknown;
    destination?: unknown;
    space_id?: unknown;
    space_name?: unknown;
    cadence?: unknown;
    hour?: unknown;
    weekday?: unknown;
    timezone?: unknown;
  } | null;

  const entitySlug =
    typeof body?.entity_slug === "string" ? body.entity_slug.trim() : "";
  if (!entitySlug) {
    throw new ApiError("`entity_slug` is required", 400, "BAD_REQUEST");
  }

  const destination = DESTINATIONS.find((value) => value === body?.destination);
  if (!destination) {
    throw new ApiError(
      `\`destination\` must be one of ${DESTINATIONS.join(", ")}`,
      400,
      "BAD_REQUEST",
    );
  }
  const cadence = CADENCES.find((value) => value === body?.cadence);
  if (!cadence) {
    throw new ApiError(
      `\`cadence\` must be one of ${CADENCES.join(", ")}`,
      400,
      "BAD_REQUEST",
    );
  }

  const spaceId = typeof body?.space_id === "string" ? body.space_id.trim() : "";
  if (destination === "space" && !spaceId) {
    throw new ApiError(
      "`space_id` is required when delivering to a space",
      400,
      "BAD_REQUEST",
    );
  }
  // A direct message is addressed by the caller's own email, which is the
  // only Webex identity the platform holds for them. Saying so here beats a
  // rule that saves cleanly and then never delivers.
  if (destination === "direct" && !email) {
    throw new ApiError(
      "Your account has no email address, so Webex cannot address a direct message to you",
      400,
      "NO_EMAIL",
    );
  }

  const hour = Number(body?.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new ApiError("`hour` must be an integer 0–23", 400, "BAD_REQUEST");
  }
  const weekday = Number(body?.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new ApiError("`weekday` must be an integer 0–6", 400, "BAD_REQUEST");
  }
  const timezone =
    typeof body?.timezone === "string" ? body.timezone.trim() : "";
  // Validated rather than defaulted: the zone decides when a digest is sent,
  // and it is used inside the scheduler loop where a throw would stop every
  // other reader's digest too.
  if (!isValidTimezone(timezone)) {
    throw new ApiError(
      "`timezone` must be an IANA time zone name",
      400,
      "BAD_REQUEST",
    );
  }

  // Re-check the slug against the caller's own read permission. The client
  // sends whatever row it drew, and a rule routes an entity's activity into
  // a chat space — so an unreadable slug must not slip through. Matching
  // the Watching tab, which guards the same way for the same reason.
  const catalog = await getCollection<ProjectDocument>("projects");
  const rows = await catalog.find({ slug: entitySlug }).toArray();
  const allowed = await filterReadableTomeProjects(subject, rows, {
    isAdmin: await isTomeAdminSubject(subject),
  });
  if (allowed.length === 0) {
    throw new ApiError("Entity not found", 404, "NOT_FOUND");
  }

  const written = await setWebexDeliveryRule({
    subject,
    entitySlug,
    rule: {
      destination,
      ...(spaceId ? { spaceId } : {}),
      ...(typeof body?.space_name === "string" && body.space_name.trim()
        ? { spaceName: body.space_name.trim() }
        : {}),
      cadence,
      hour,
      weekday,
      timezone,
    },
  });
  if (!written) {
    throw new ApiError(
      "Follow this project before choosing where its updates go",
      409,
      "NOT_WATCHED",
    );
  }

  const settings: WebexDeliverySettings = {
    capability: webexDeliveryCapability(),
    rules: await listWebexDeliveryRules(subject),
  };
  return successResponse(settings);
});
