// GET /api/projects/[slug]/wiki/unread — which wiki pages of this entity have
// activity the caller has not opened, so the tree can dot them.

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getTomeProjectPermissions } from "@/lib/tome/data-steward";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";
import { resolveUniqueTomeProjectBySlug } from "@/lib/tome/project-resolver";
import { getUnreadWikiPages } from "@/lib/tome/wiki-unread.server";

export const dynamic = "force-dynamic";

/**
 * Gated on the same read permission as the entity itself, and narrowed to the
 * caller's own notification audience inside `getUnreadWikiPages`. A dot is a
 * small thing to leak, but it still says a page changed and who it concerns.
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

    return successResponse({
      pages: await getUnreadWikiPages({ entitySlug: project.slug, subject }),
    });
  },
);
