import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  buildMyAgentConsentMutation,
  buildMyAgentConsentSelfRevoke,
  myAgentConsentRevisionFilter,
  myAgentConsentSubjectFilter,
} from "@/lib/projects/myagent-consent-update";
import {
  myAgentConsentSubjectFromSession,
  myAgentConnectorsForSubject,
  myAgentSourcesForSubject,
} from "@/lib/projects/myagent-source";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { isMyAgentInteractiveBrowserAction } from "@/lib/tome/myagent-interactive";
import { resolveUniqueTomeProjectBySlug } from "@/lib/tome/project-resolver";
import { getTomeProjectPermissions } from "@/lib/tome/data-steward";
import type { ProjectDocument } from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function requireBrowserConsentSubject(session: unknown): string {
  const subject = myAgentConsentSubjectFromSession(session);
  if (!subject) {
    throw new ApiError(
      "MyAgent delegation must be authorized from your signed-in browser session.",
      403,
      "MYAGENT_INTERACTIVE_CONSENT_REQUIRED",
    );
  }
  return subject;
}

function pipelineWithMetadata(
  update: ReturnType<typeof buildMyAgentConsentMutation>["update"],
) {
  return [
    ...update,
    { $set: { updated_at: new Date() } },
    { $unset: ["sources.myagent_connectors", "sources.myagent_enabled"] },
  ];
}

function expectedRevision(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The self-revoke route deliberately returns the same 200 whether a former
 * collaborator has access to a slug or not. A duplicate legacy slug is also
 * non-enumerating here: it cannot safely receive an absent-record fallback,
 * but it must not turn Disconnect into a collision disclosure/error.
 */
async function resolveUniqueProjectForRevokeFallback(
  slug: string,
): Promise<ProjectDocument | null> {
  try {
    return await resolveUniqueTomeProjectBySlug(slug);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "PROJECT_SLUG_AMBIGUOUS"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Grant or change the current browser user's delegated MyAgent request. This
 * is deliberately separate from the generic project PATCH: the update
 * pipeline owns exactly one subject's record, and an opaque revision rejects
 * stale cross-tab grants after a newer choice or disconnect.
 */
export const PUT = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }
  const { user, session } = await getAuthFromBearerOrSession(request);
  const subject = requireBrowserConsentSubject(session);
  if (!isMyAgentInteractiveBrowserAction(request, session)) {
    throw new ApiError(
      "MyAgent delegation must be authorized from an explicit action in your signed-in browser.",
      403,
      "MYAGENT_INTERACTIVE_CONSENT_REQUIRED",
    );
  }
  const { slug } = await ctx.params;
  const project = await resolveUniqueTomeProjectBySlug(slug);
  if (!project) throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
  if (project.type === "area" || project.type === "bhag") {
    throw new ApiError(
      "MyAgent delegation is available only for project ingestion, not Area or BHAG synthesis.",
      400,
      "MYAGENT_PROJECT_ONLY",
    );
  }
  const permissions = await getTomeProjectPermissions({ project, user, session });
  if (!permissions.canEdit) {
    throw new ApiError(
      "Only this entity's data steward or a Tome admin can configure project sources.",
      403,
      "DATA_STEWARD_REQUIRED",
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    connectors?: unknown;
    revision?: unknown;
  };
  const mutation = buildMyAgentConsentMutation({
    subject,
    connectors: body.connectors,
    grantedAt: new Date().toISOString(),
    nextRevision: randomUUID(),
  });
  if (mutation.kind !== "upsert") {
    throw new ApiError(
      "Choose at least one MyAgent connector before authorizing delegation.",
      400,
      "MYAGENT_CONNECTOR_REQUIRED",
    );
  }
  const before = myAgentConnectorsForSubject(project.sources, subject);
  const projects = await getCollection<ProjectDocument>("projects");
  const result = await projects.updateOne(
    {
      _id: project._id,
      ...myAgentConsentRevisionFilter(subject, expectedRevision(body.revision)),
    },
    pipelineWithMetadata(mutation.update),
  );
  if (result.matchedCount === 0) {
    throw new ApiError(
      "Your MyAgent selection changed in another session. Reload before saving again.",
      409,
      "MYAGENT_CONSENT_CONFLICT",
    );
  }
  const updated = await projects.findOne({ _id: project._id });
  if (!updated) throw new ApiError("Project not found after update", 500, "UPDATE_FAILED");
  const after = myAgentConnectorsForSubject(updated.sources, subject);
  if (before.join("\0") !== after.join("\0")) {
    auditTome({
      action: "tome.source.myagent_consent_grant",
      actor: tomeActorFromAuth({ user, session }),
      projectSlug: slug,
      metadata: { before_connectors: before, after_connectors: after },
    });
  }
  return successResponse({ sources: myAgentSourcesForSubject(updated.sources, subject) });
});

/**
 * Revoke only the authenticated browser user's record. It intentionally does
 * not require project read access: a former collaborator must be able to stop
 * future delegation after losing access to the project. It writes a minimal
 * tombstone, so this unconditional revoke takes precedence over a delayed PUT
 * based on the prior revision. The response does not disclose whether the slug
 * or consent existed.
 */
export const DELETE = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }
  const { user, session } = await getAuthFromBearerOrSession(request);
  const subject = requireBrowserConsentSubject(session);
  // Disconnect is a credential/authorization mutation just like grant. It
  // remains available to a former collaborator, but a cookie alone must not
  // let a cross-site form or forwarded MCP request revoke their delegation.
  if (!isMyAgentInteractiveBrowserAction(request, session)) {
    throw new ApiError(
      "MyAgent delegation must be changed from an explicit action in your signed-in browser.",
      403,
      "MYAGENT_INTERACTIVE_CONSENT_REQUIRED",
    );
  }
  const { slug } = await ctx.params;
  const mutation = buildMyAgentConsentSelfRevoke(
    subject,
    randomUUID(),
    new Date().toISOString(),
  );
  const projects = await getCollection<ProjectDocument>("projects");
  // A legacy deployment might contain duplicate documents with the same slug.
  // A disconnect must remove this caller's consent from all of them without
  // probing which document they can currently read.
  const existing = await projects.updateMany(
    { slug, ...myAgentConsentSubjectFilter(subject) },
    pipelineWithMetadata(mutation.update),
  );
  let tombstoneWritten = existing.matchedCount > 0;
  if (!tombstoneWritten) {
    // A first-time grant can be in flight from another tab while this user
    // presses Disconnect. There is no subject record for updateMany to match
    // yet, so a current editor gets an absent-record tombstone as well. That
    // makes the delayed initial PUT's null revision fail. Do this only after
    // normalizing the no-access response: a former collaborator with no
    // record still learns nothing and does not create state in an arbitrary
    // guessed project.
    const project = await resolveUniqueProjectForRevokeFallback(slug);
    if (project) {
      const permissions = await getTomeProjectPermissions({ project, user, session });
      if (permissions.canEdit) {
        const fallback = await projects.updateOne(
          { _id: project._id },
          pipelineWithMetadata(mutation.update),
        );
        tombstoneWritten = fallback.matchedCount > 0;
      }
    }
  }
  if (tombstoneWritten) {
    auditTome({
      action: "tome.source.myagent_consent_revoke",
      actor: tomeActorFromAuth({ user, session }),
      projectSlug: slug,
      metadata: {},
    });
  }
  return successResponse({
    revoked: true,
    // No matched record means no tombstone exists to compare against. Use the
    // empty sentinel so a subsequent initial grant can still be made.
    revision: tombstoneWritten ? mutation.revision : null,
  });
});
