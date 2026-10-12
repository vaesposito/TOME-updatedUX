// assisted-by Cursor Composer

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { projectCatalogBundleYaml } from "@/lib/projects/backstage-catalog";
import {
  normalizeConfluencePageScope,
  normalizeConfluencePageScopes,
  normalizeConfluenceSpaces,
  parseConfluenceUrl,
} from "@/lib/projects/confluence-source";
import {
  myAgentSourcesForSubject,
} from "@/lib/projects/myagent-source";
import { runOnboardingDeletes, runOnboardingUpdates } from "@/lib/projects/onboarding-providers";
import { normalizeGitHubRepositorySource } from "@/lib/projects/github-repository";
import {
  canAssignProjectToTeam,
  canManageProjectsOrganization,
} from "@/lib/projects/project-admin";
import { cleanLabelList } from "@/lib/projects/labels";
import { isBootstrapAdmin } from "@/lib/auth-config";
import { isValidCron } from "@/lib/rbac/cron";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { auditTome, tomeActorFromAuth, type TomeAuditActor } from "@/lib/tome/audit";
import {
  normalizeWebexCredentialSettings,
} from "@/lib/tome/managed-webex";
import { prepareWebexRooms } from "@/lib/tome/webex-room-execution";
import { prepareSharePointSources } from "@/lib/tome/sharepoint";
import { sharePointSourceKey } from "@/lib/projects/sharepoint-source";
import { resolveUniqueTomeProjectBySlug } from "@/lib/tome/project-resolver";
import {
  getTomeReadConfiguration,
  invalidateTomeReadAccessCatalogCache,
  reconcileTomeReadAccess,
  removeTomeReadAccess,
} from "@/lib/tome/access";
import {
  dataStewardOpenFgaSubject,
  getTomeProjectPermissions,
  reconcileDataSteward,
  resolveDataSteward,
  resolveStoredDataSteward,
  tomeSessionSubject,
} from "@/lib/tome/data-steward";
import { sessionSub } from "@/lib/tome/agent-proxy";
import {
  notifyEntityWatchers,
  removeAllEntityWatchers,
  summarizeTomeEntityChange,
  watchEventStamp,
} from "@/lib/tome/watchers";
import type {
  DataStewardInput,
  ProjectDocument,
  TomeReportVisibility,
  TomeReviewMode,
  WebexCredentialMode,
  WebexRoomSource,
} from "@/types/projects";
import type { Team } from "@/types/teams";

/**
 * Resolve a team by Mongo `_id` (string) or `slug`. Returns the team with a
 * stringified `_id`, or null when not found.
 */
async function resolveTeamByIdOrSlug(
  idOrSlug: string,
): Promise<(Team & { _id: string }) | null> {
  const teams = await getCollection<Team>("teams");
  let team: Team | null = null;
  if (ObjectId.isValid(idOrSlug)) {
    team = await teams.findOne({ _id: new ObjectId(idOrSlug) as unknown as string });
  }
  if (!team) team = await teams.findOne({ slug: idOrSlug });
  return team ? { ...team, _id: String(team._id) } : null;
}


/** Emit `tome.source.attach`/`detach` events for what changed between the
 * project's sources before and after a PATCH. Repos compared by value;
 * Webex rooms by `room_id`; Confluence by effective space key (see
 * `confluenceSpaceKeys`). MyAgent consent is deliberately handled by its own
 * subject-scoped endpoint and is never accepted here. */
function auditSourceChanges(
  slug: string,
  actor: TomeAuditActor,
  before: ProjectDocument["sources"] | undefined,
  after: ProjectDocument["sources"] | undefined,
): void {
  const emit = (
    action: "tome.source.attach" | "tome.source.detach",
    sourceType: string,
    ref: string,
  ) => auditTome({ action, actor, projectSlug: slug, metadata: { source_type: sourceType, ref } });

  // key is base_url-qualified (space_keys can collide across sites); ref is the bare key logged to the audit trail.
  const diffByKey = (
    type: string,
    oldEntries: { key: string; ref: string }[],
    newEntries: { key: string; ref: string }[],
  ) => {
    const o = new Map(oldEntries.map((e) => [e.key, e.ref]));
    const n = new Map(newEntries.map((e) => [e.key, e.ref]));
    for (const [key, ref] of n) if (!o.has(key)) emit("tome.source.attach", type, ref);
    for (const [key, ref] of o) if (!n.has(key)) emit("tome.source.detach", type, ref);
  };

  const diffList = (type: string, oldArr: string[], newArr: string[]) =>
    diffByKey(
      type,
      oldArr.filter(Boolean).map((ref) => ({ key: ref, ref })),
      newArr.filter(Boolean).map((ref) => ({ key: ref, ref })),
    );

  diffList("repo", before?.repos ?? [], after?.repos ?? []);
  diffList("sharepoint_document", (before?.sharepoint_documents ?? []).map(sharePointSourceKey),
    (after?.sharepoint_documents ?? []).map(sharePointSourceKey));
  diffList(
    "webex_room",
    (before?.webex_rooms ?? []).map((r) => r.room_id).filter(Boolean),
    (after?.webex_rooms ?? []).map((r) => r.room_id).filter(Boolean),
  );
  diffByKey(
    "confluence",
    confluenceSpaceEntries(before),
    confluenceSpaceEntries(after),
  );
}

/** A project's effective Confluence spaces as `{key, ref}` pairs, preferring the typed array over the legacy `confluence_url`. */
function confluenceSpaceEntries(
  sources: ProjectDocument["sources"] | undefined,
): { key: string; ref: string }[] {
  if (sources?.confluence_spaces?.length) {
    return sources.confluence_spaces
      .filter((s) => s.space_key)
      .map((s) => ({ key: `${s.base_url ?? ""}::${s.space_key}`, ref: s.space_key }));
  }
  const parsed = sources?.confluence_url
    ? parseConfluenceUrl(sources.confluence_url)
    : undefined;
  return parsed?.space_key
    ? [{ key: `${parsed.base_url ?? ""}::${parsed.space_key}`, ref: parsed.space_key }]
    : [];
}

export const GET = withErrorHandler(
  async (_request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
    }

    const { user, session } = await getAuthFromBearerOrSession(_request);
    const { slug } = await context.params;

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
    const [readConfiguration, steward] = await Promise.all([
      getTomeReadConfiguration(project),
      resolveStoredDataSteward(project.data_steward).catch(() => null),
    ]);
    return successResponse({
      project: {
        ...project,
        _id: String(project._id),
        sources: myAgentSourcesForSubject(project.sources, sessionSub(session)),
      },
      permissions: {
        can_read: permissions.canRead,
        can_edit: permissions.canEdit,
        can_manage_steward: permissions.canManageSteward,
      },
      rbac: {
        ...readConfiguration,
        dataSteward: steward
          ? {
              type: steward.type,
              name: steward.name,
              subject: dataStewardOpenFgaSubject(steward),
              relation: "writer",
            }
          : null,
        tomeAdminOverride: "admin_surface:tome#can_manage",
      },
      catalog_yaml: projectCatalogBundleYaml(project),
    });
  },
);

// DELETE an entity. Regular projects may be deleted by their OpenFGA data
// steward or a Tome admin. BHAGs and Areas shape the shared hierarchy, so only
// Tome admins may delete them.
// Cascades to external resources for onboarding steps configured with a
// `deleteEndpoint` (best-effort) before removing the CAIPE record.
export const DELETE = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
    }

    const { user, session } = await getAuthFromBearerOrSession(request);
    const { slug } = await context.params;

    const projects = await getCollection<ProjectDocument>("projects");
    const project = await resolveUniqueTomeProjectBySlug(slug);
    if (!project) {
      throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    const permissions = await getTomeProjectPermissions({ project, user, session });
    if (
      (project.type === "bhag" || project.type === "area") &&
      !permissions.canManageSteward
    ) {
      throw new ApiError(
        "Only a Tome admin can delete a BHAG or Area",
        403,
        "TOME_ADMIN_REQUIRED",
      );
    }
    if (!permissions.canEdit) {
      throw new ApiError(
        "Only this entity's data steward or a Tome admin can delete it",
        403,
        "DATA_STEWARD_REQUIRED",
      );
    }

    // Cascade external deletions first (best-effort; never blocks the local
    // delete). Uses the OIDC sub so the external system authorizes the actor.
    const sub = (session as { sub?: string } | undefined)?.sub;
    const externalDeletes = await runOnboardingDeletes(project, sub);

    // Migrate legacy slug tuples before removing this exact ID so stale
    // readers/parents cannot survive an administrator deleting an old record.
    await reconcileTomeReadAccess(project);
    await Promise.all([
      removeTomeReadAccess(project),
      reconcileDataSteward(project, null),
      removeAllEntityWatchers(project.slug),
    ]);
    await projects.deleteOne({ _id: project._id });
    await (
      await getCollection<{ _id: string; project_id: string }>(
        "project_slug_reservations",
      )
    ).deleteOne({
      _id: slug,
      project_id: String(project._id),
    });
    invalidateTomeReadAccessCatalogCache();

    auditTome({
      action: "tome.project.delete",
      actor: tomeActorFromAuth({ user, session }),
      projectSlug: slug,
      metadata: { type: project.type ?? "project", name: project.name },
    });

    return successResponse({ deleted: true, slug, external: externalDeletes });
  },
);

// PATCH a project's editable fields (title, description, sources).
// Allowed for its OpenFGA data steward or a Tome admin. Steward assignment
// itself remains Tome-admin-only.
// Syncs changes to external resources via configured `updateEndpoint` steps.
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ slug: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
    }

    const { user, session } = await getAuthFromBearerOrSession(request);
    const { slug } = await context.params;

    const projects = await getCollection<ProjectDocument>("projects");
    const project = await resolveUniqueTomeProjectBySlug(slug);
    if (!project) {
      throw new ApiError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    const permissions = await getTomeProjectPermissions({ project, user, session });
    const isOrgAdmin =
      permissions.canManageSteward ||
      (await canManageProjectsOrganization(session)) ||
      isBootstrapAdmin(user.email);
    if (!permissions.canEdit) {
      throw new ApiError(
        "Only this entity's data steward or a Tome admin can edit it",
        403,
        "DATA_STEWARD_REQUIRED",
      );
    }

    const body = (await request.json()) as {
      title?: string;
      description?: string;
      initiatives?: string[];
      areas?: string[];
      team_id?: string;
      sources?: {
        sharepoint_documents?: unknown;
        repos?: string[];
        github_repos?: unknown;
        confluence_url?: string;
        confluence_page_scopes?: unknown;
        confluence_page_scope?: unknown;
        confluence_spaces?: unknown;
        webex_rooms?: Array<Partial<WebexRoomSource>>;
        webex_credential_mode?: WebexCredentialMode;
        webex_credential_provider?: string;
      };
      /** Scoped user/team steward for this Project, Area, or BHAG. */
      data_steward?: DataStewardInput | null;
      /** Per-project source-feed on/off. */
      sources_feed_enabled?: boolean;
      /** Project-scoped visibility for the Reports group and its surfaces. */
      report_visibility?: Partial<TomeReportVisibility>;
      /** How much draft/HITL review gates agent-written page changes. */
      review_mode?: TomeReviewMode | null;
      decision_blast_radius?: "small" | "large" | null;
      optionality?: string[];
      /**
       * CRON-scheduled auto-ingest. `credentialOwnerEmail` is the explicit
       * fallback identity whose forwarded credentials scheduled runs use —
       * never derived from the (possibly team) data steward. `null` clears
       * the owner (schedule stays configured but won't fire until reset).
       */
      autoIngest?: {
        enabled?: boolean;
        cron?: string;
        credentialOwnerEmail?: string | null;
      } | null;
    };

    if ("data_steward" in body && !permissions.canManageSteward) {
      throw new ApiError(
        "Only a Tome admin can change the data steward",
        403,
        "TOME_ADMIN_REQUIRED",
      );
    }
    if ("autoIngest" in body && !permissions.canEdit) {
      throw new ApiError(
        "Only this entity's data steward or a Tome admin can change the auto-ingest schedule",
        403,
        "DATA_STEWARD_REQUIRED",
      );
    }

    const $set: Record<string, unknown> = { updated_at: new Date() };
    if (typeof body.title === "string" && body.title.trim()) {
      $set["title"] = body.title.trim();
    }
    if (typeof body.description === "string") {
      $set["description"] = body.description.trim();
    }
    // Label dimensions (BHAG/Initiative + Swim Lane). Dot-path writes preserve
    // `labels.domain`, which isn't editable here.
    if (Array.isArray(body.initiatives)) {
      $set["labels.initiatives"] = cleanLabelList(body.initiatives);
    }
    if (Array.isArray(body.areas)) {
      $set["labels.areas"] = cleanLabelList(body.areas);
    }
    // Team reassignment — only when it actually changes, and only if the actor
    // is allowed to move the project into the target team. Updates the team
    // triple (id/slug/name) that drives RBAC visibility.
    if (typeof body.team_id === "string" && body.team_id.trim()) {
      const target = await resolveTeamByIdOrSlug(body.team_id.trim());
      if (!target) {
        throw new ApiError("Target team not found", 404, "TEAM_NOT_FOUND");
      }
      if (target._id !== project.team_id && target.slug !== project.team_slug) {
        const allowed = await canAssignProjectToTeam(target, user.email, isOrgAdmin);
        if (!allowed) {
          throw new ApiError(
            "You are not allowed to move this project into that team",
            403,
            "FORBIDDEN_TEAM_ASSIGNMENT",
          );
        }
        $set["team_id"] = target._id;
        $set["team_slug"] = target.slug ?? target._id;
        $set["team_name"] = target.name;
      }
    }
    const $unset: Record<string, ""> = {};
    let nextDataSteward = null;
    if ("data_steward" in body) {
      if (!body.data_steward) {
        throw new ApiError(
          "A Project, Area, or BHAG must have a data steward",
          400,
          "DATA_STEWARD_REQUIRED",
        );
      }
      nextDataSteward = await resolveDataSteward(body.data_steward);
      if (!nextDataSteward) {
        throw new ApiError("Data steward is required", 400, "DATA_STEWARD_REQUIRED");
      }
      $set["data_steward"] = nextDataSteward;
    }
    if (typeof body.sources_feed_enabled === "boolean") {
      $set["sources_feed_enabled"] = body.sources_feed_enabled;
    }
    if ("report_visibility" in body) {
      const visibility = body.report_visibility;
      if (!visibility || typeof visibility !== "object" || Array.isArray(visibility)) {
        throw new ApiError("`report_visibility` must be an object", 400, "BAD_REQUEST");
      }
      for (const key of ["enabled", "standup", "issues"] as const) {
        if (key in visibility && typeof visibility[key] !== "boolean") {
          throw new ApiError(
            `\`report_visibility.${key}\` must be a boolean`,
            400,
            "BAD_REQUEST",
          );
        }
      }
      $set["report_visibility"] = {
        enabled: visibility.enabled ?? project.report_visibility?.enabled ?? true,
        standup: visibility.standup ?? project.report_visibility?.standup ?? true,
        issues: visibility.issues ?? project.report_visibility?.issues ?? true,
      } satisfies TomeReportVisibility;
    }
    if ("review_mode" in body) {
      if (body.review_mode === null) {
        $unset["review_mode"] = "";
      } else if (!["none", "stable_only", "all"].includes(body.review_mode)) {
        throw new ApiError(
          "`review_mode` must be one of: none, stable_only, all",
          400,
          "BAD_REQUEST",
        );
      } else {
        $set["review_mode"] = body.review_mode;
      }
    }
    if ("autoIngest" in body) {
      if (!body.autoIngest) {
        $unset["autoIngest"] = "";
      } else {
        if (typeof body.autoIngest.enabled === "boolean") {
          $set["autoIngest.enabled"] = body.autoIngest.enabled;
        }
        if (typeof body.autoIngest.cron === "string") {
          if (!isValidCron(body.autoIngest.cron)) {
            throw new ApiError("Invalid auto-ingest schedule", 400, "INVALID_AUTO_INGEST_CRON");
          }
          $set["autoIngest.cron"] = body.autoIngest.cron.trim();
        }
        if ("credentialOwnerEmail" in body.autoIngest) {
          if (!body.autoIngest.credentialOwnerEmail) {
            $set["autoIngest.credentialOwner"] = null;
          } else {
            // Reuse the same "must have signed into CAIPE" resolution the data
            // steward uses — the credential owner is a distinct, explicit
            // identity, never derived from the (possibly team) steward.
            const owner = await resolveDataSteward({
              type: "user",
              email: body.autoIngest.credentialOwnerEmail,
            });
            if (!owner) {
              throw new ApiError(
                "Auto-ingest credential owner is required",
                400,
                "INVALID_AUTO_INGEST_OWNER",
              );
            }
            $set["autoIngest.credentialOwner"] = {
              subject: owner.id,
              email: owner.email ?? body.autoIngest.credentialOwnerEmail.trim().toLowerCase(),
              name: owner.name,
              confirmedAt: new Date().toISOString(),
            };
          }
        }
      }
    }
    if ("decision_blast_radius" in body) {
      if (body.decision_blast_radius) $set["decision_blast_radius"] = body.decision_blast_radius;
      else $unset["decision_blast_radius"] = "";
    }
    if (Array.isArray(body.optionality)) {
      if (body.optionality.length) $set["optionality"] = body.optionality;
      else $unset["optionality"] = "";
    }
    if (body.sources) {
      if ("sharepoint_documents" in body.sources) {
        $set["sources.sharepoint_documents"] = await prepareSharePointSources(
          body.sources.sharepoint_documents, project.sources?.sharepoint_documents,
        );
      }
      if (
        "myagent_connectors" in body.sources ||
        "myagent_enabled" in body.sources ||
        "myagent_consent_revision" in body.sources ||
        "myagent_consents" in (body.sources as Record<string, unknown>)
      ) {
        throw new ApiError(
          "MyAgent delegation must be changed through its dedicated consent endpoint.",
          400,
          "MYAGENT_CONSENT_ENDPOINT_REQUIRED",
        );
      }
      const cleanWebexRooms = (
        rooms: Array<Partial<WebexRoomSource>>,
      ): WebexRoomSource[] =>
        rooms
          .filter((r) => r && typeof r.room_id === "string" && r.room_id.trim())
          .map((r) => ({
            room_id: r.room_id!.trim(),
            name: (r.name ?? "").trim() || r.room_id!.trim(),
            slug: (r.slug ?? "").trim(),
            credential_mode: r.credential_mode,
            credential_provider: r.credential_provider,
          }));
      const nextWebexSettings = normalizeWebexCredentialSettings({
        mode:
          body.sources.webex_credential_mode ??
          project.sources?.webex_credential_mode ??
          "personal",
        provider:
          body.sources.webex_credential_provider ??
          project.sources?.webex_credential_provider ??
          "webex",
      });
      const nextWebexRooms = Array.isArray(body.sources.webex_rooms)
        ? await prepareWebexRooms({
            rooms: cleanWebexRooms(body.sources.webex_rooms),
            previousSources: project.sources,
            subject: tomeSessionSubject(session) ?? "",
            userEmail: user.email,
            userName: session.user?.name,
            defaults: nextWebexSettings,
          })
        : project.sources?.webex_rooms ?? [];
      if (
        "webex_credential_mode" in body.sources ||
        "webex_credential_provider" in body.sources
      ) {
        const before = normalizeWebexCredentialSettings({ mode: project.sources?.webex_credential_mode,
          provider: project.sources?.webex_credential_provider });
        if (nextWebexRooms.some((room) => !room.credential_mode) &&
            (before.mode !== nextWebexSettings.mode || before.provider !== nextWebexSettings.provider)) {
          throw new ApiError("Remove and re-add legacy spaces to change their account type.", 409, "WEBEX_LEGACY_ACCOUNT_CHANGE");
        }
        $set["sources.webex_credential_mode"] = nextWebexSettings.mode;
        $set["sources.webex_credential_provider"] = nextWebexSettings.provider;
      }
      if (Array.isArray(body.sources.github_repos)) {
        const githubRepos = body.sources.github_repos
          .map(normalizeGitHubRepositorySource)
          .filter((repo) => repo !== null);
        $set["sources.github_repos"] = githubRepos;
        $set["sources.repos"] = githubRepos.map((repo) => repo.html_url);
      } else if (Array.isArray(body.sources.repos)) {
        $set["sources.repos"] = body.sources.repos.map((r) => r.trim()).filter(Boolean);
        // A legacy-only selection cannot safely retain identity metadata from
        // an older selection. The next ingest resolves and repopulates it.
        $unset["sources.github_repos"] = "";
      }
      if ("confluence_spaces" in body.sources) {
        const confluenceSpaces = normalizeConfluenceSpaces(
          body.sources.confluence_spaces,
        );
        $set["sources.confluence_spaces"] = confluenceSpaces;
        // Mutually exclusive with the else branch below — same path can't be in both $set and $unset.
        $unset["sources.confluence_url"] = "";
        $unset["sources.confluence_page_scopes"] = "";
        $unset["sources.confluence_page_scope"] = "";
      } else {
        if (typeof body.sources.confluence_url === "string") {
          $set["sources.confluence_url"] = body.sources.confluence_url.trim();
        }
        if ("confluence_page_scopes" in body.sources) {
          const pageScopes = normalizeConfluencePageScopes(
            body.sources.confluence_page_scopes,
          );
          if (pageScopes.length) {
            $set["sources.confluence_page_scopes"] = pageScopes;
            $unset["sources.confluence_page_scope"] = "";
          } else {
            $unset["sources.confluence_page_scopes"] = "";
          }
        }
        if ("confluence_page_scope" in body.sources) {
          const pageScope = normalizeConfluencePageScope(
            body.sources.confluence_page_scope,
          );
          if (pageScope) $set["sources.confluence_page_scope"] = pageScope;
          else $unset["sources.confluence_page_scope"] = "";
        }
      }
      if (Array.isArray(body.sources.webex_rooms)) {
        $set["sources.webex_rooms"] = nextWebexRooms;
      }
    }

    const accessChanged = [
      "team_id",
      "team_slug",
      "team_name",
      "labels.initiatives",
      "labels.areas",
    ].some((key) => key in $set);
    const accessProjection: ProjectDocument = {
      ...project,
      team_id: (typeof $set.team_id === "string" ? $set.team_id : project.team_id),
      team_slug: (typeof $set.team_slug === "string" ? $set.team_slug : project.team_slug),
      team_name: (typeof $set.team_name === "string" ? $set.team_name : project.team_name),
      labels: {
        ...project.labels,
        ...("labels.initiatives" in $set
          ? { initiatives: $set["labels.initiatives"] as string[] }
          : {}),
        ...("labels.areas" in $set
          ? { areas: $set["labels.areas"] as string[] }
          : {}),
      },
    };
    if (accessChanged) {
      await reconcileTomeReadAccess(accessProjection);
    }

    try {
      if (nextDataSteward) {
        await reconcileDataSteward(project, nextDataSteward);
      }
      await projects.updateOne(
        { _id: project._id },
        Object.keys($unset).length > 0 ? { $set, $unset } : { $set },
      );
      invalidateTomeReadAccessCatalogCache();
    } catch (error) {
      if (accessChanged) {
        await reconcileTomeReadAccess(project).catch((rollbackError) => {
          console.error("[tome] failed to roll back read-access projection", rollbackError);
        });
      }
      if (nextDataSteward) {
        const previousSteward = await resolveStoredDataSteward(project.data_steward).catch(() => null);
        await reconcileDataSteward(
          { ...project, data_steward: nextDataSteward },
          previousSteward,
        ).catch((rollbackError) => {
          console.error("[tome] failed to roll back data-steward projection", rollbackError);
        });
      }
      throw error;
    }

    const updated = await projects.findOne({ _id: project._id });
    if (!updated) throw new ApiError("Project not found after update", 500, "UPDATE_FAILED");

    const sub = (session as { sub?: string } | undefined)?.sub;
    const externalUpdates = await runOnboardingUpdates(
      {
        ...updated,
        sources: myAgentSourcesForSubject(updated.sources, sub),
      },
      sub,
    );

    const actor = tomeActorFromAuth({ user, session });
    // Metadata edit vs source change are distinct audit actions; a PATCH can be
    // either or both.
    const metaChanged = [
      "title",
      "description",
      "labels.initiatives",
      "labels.areas",
      "team_id",
      "report_visibility",
    ].some((k) => k in $set);
    if (metaChanged) {
      auditTome({ action: "tome.project.update", actor, projectSlug: slug });
    }
    if (body.sources) {
      auditSourceChanges(slug, actor, project.sources, updated.sources);
      const previousMode =
        project.sources?.webex_credential_mode === "managed" ? "managed" : "personal";
      const updatedMode =
        updated.sources?.webex_credential_mode === "managed" ? "managed" : "personal";
      if (previousMode !== updatedMode) {
        auditTome({
          action: "tome.source.webex_credential_mode_change",
          actor,
          projectSlug: slug,
          metadata: { from: previousMode, to: updatedMode },
        });
      }
    }

    // Watchers hear about the change; the editor does not hear about their own.
    // Never let a notification failure fail an edit that already committed.
    const watchSummary = summarizeTomeEntityChange([
      ...Object.keys($set),
      ...Object.keys($unset),
    ]);
    if (watchSummary) {
      await notifyEntityWatchers({
        entitySlug: updated.slug,
        entityTitle: updated.title,
        summary: watchSummary,
        actorLabel: user.email ?? undefined,
        eventKey: `tome.watch.${updated.slug}.${watchEventStamp(updated.updated_at)}`,
        href: `/projects/${encodeURIComponent(updated.slug)}/tome`,
        excludeSubject: sessionSub(session),
      }).catch((error) => {
        console.error("[tome] failed to notify watchers", error);
      });
    }

    const updatedReadConfiguration = await getTomeReadConfiguration(updated);
    const updatedSteward = await resolveStoredDataSteward(updated.data_steward).catch(() => null);
    return successResponse({
      project: {
        ...updated,
        _id: String(updated._id),
        sources: myAgentSourcesForSubject(updated.sources, sessionSub(session)),
      },
      rbac: {
        ...updatedReadConfiguration,
        dataSteward: updatedSteward
          ? {
              type: updatedSteward.type,
              name: updatedSteward.name,
              subject: dataStewardOpenFgaSubject(updatedSteward),
              relation: "writer",
            }
          : null,
        tomeAdminOverride: "admin_surface:tome#can_manage",
      },
      external: externalUpdates,
    });
  },
);
