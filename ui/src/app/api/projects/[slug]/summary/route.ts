import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getTomeProjectPermissions } from "@/lib/tome/data-steward";
import { getEntitySummary } from "@/lib/tome/entity-summary.server";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";
import { resolveUniqueTomeProjectBySlug } from "@/lib/tome/project-resolver";
import type { TomeSummaryScope } from "@/types/tome-summary";

export const dynamic = "force-dynamic";

/**
 * The summary for one BHAG, Area or Project.
 *
 * Gated on the same read permission as the entity itself: the digest spans a
 * subtree, so opening it must not become a way to learn what is happening in
 * an entity that was never shared with you. Rows are additionally filtered to
 * the caller's own notification audience inside `getEntitySummary`.
 */
export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
    }
    const { slug } = await context.params;
    const { user, session } = await getAuthFromBearerOrSession(request);
    requireInteractiveTomePrincipal(session);

    const project = await resolveUniqueTomeProjectBySlug(slug);
    if (!project) {
      throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
    }
    const permissions = await getTomeProjectPermissions({ project, user, session });
    if (!permissions.canRead) {
      throw new ApiError(
        "This Tome entity is not shared with one of your teams",
        403,
        "TOME_READ_REQUIRED",
      );
    }
    const subject = typeof session.sub === "string" ? session.sub.trim() : "";
    if (!subject) {
      throw new ApiError("Your session has expired. Please sign in again.", 401, "NO_TOKEN");
    }

    const requested = request.nextUrl.searchParams.get("scope");
    const scope: TomeSummaryScope = requested === "for_me" ? "for_me" : "all";
    // A caller that divides the rows between cards and then counts them has
    // to be given more than it shows, or its counts describe the digest's
    // page size rather than the entity. Bounded in getEntitySummary.
    const rows = Number(request.nextUrl.searchParams.get("rows"));

    return successResponse(
      await getEntitySummary({
        entity: project,
        principal: { subject, email: user.email ?? "" },
        scope,
        rows,
      }),
    );
  },
);
