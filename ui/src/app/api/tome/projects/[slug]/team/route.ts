// Who works on a project. Powers the Team card on a project's Home.
//
// Read-only, and gated on reading the project itself: a project's readers are
// its owning team's members, so this tells people who they already work
// alongside. Names and addresses are resolved from the user directory, which
// any signed-in user can already search; the roster adds the grouping, not
// the identities. Roles come from the canonical membership store rather than
// the team document, whose own members array is no longer authoritative.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { loadActiveTeamMembersPage } from "@/lib/rbac/team-membership-store";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { countEntityWatchers } from "@/lib/tome/watchers";
import { dataStewardLabel } from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * How many members cross the wire.
 *
 * The card shows a handful and reports the rest as a count, so a team of
 * three hundred costs the same as a team of ten. Asking for one more than is
 * shown is deliberate: it is the total that tells the card whether to offer
 * "and N others", and the total comes back regardless.
 */
const ROSTER_LIMIT = 12;

interface DirectoryUser {
  email?: string;
  name?: string;
  avatar_url?: string;
}

/** Display names for a set of addresses, in one query. */
async function namesByEmail(
  emails: readonly string[],
): Promise<Map<string, DirectoryUser>> {
  const wanted = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))];
  if (wanted.length === 0) return new Map();
  const users = await getCollection<DirectoryUser>("users");
  const rows = await users
    .find({ email: { $in: wanted } }, { projection: { email: 1, name: 1, avatar_url: 1 } })
    .toArray();
  return new Map(
    rows.flatMap((row) =>
      row.email ? [[row.email.toLowerCase(), row] as const] : [],
    ),
  );
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const { project } = await loadTomeProject(request, slug);

  const teamSlug = project.team_slug ?? "";
  const roster = teamSlug
    ? await loadActiveTeamMembersPage(teamSlug, {
        pageSize: ROSTER_LIMIT,
        ownerEmail: project.owner_id ?? undefined,
      })
    : { members: [], total: 0 };

  const directory = await namesByEmail(
    roster.members.flatMap((member) => (member.user_email ? [member.user_email] : [])),
  );

  // Watchers are people too, and the count is the one number that says how
  // many are actually listening rather than merely entitled to.
  const watchers = await countEntityWatchers(slug).catch(() => 0);

  return successResponse({
    team: teamSlug ? { slug: teamSlug, name: project.team_name ?? teamSlug } : null,
    members: roster.members.map((member) => {
      const found = member.user_email
        ? directory.get(member.user_email.toLowerCase())
        : undefined;
      return {
        email: member.user_email ?? "",
        // The address is a usable name when the directory has no better one,
        // which happens for a member invited but never signed in.
        name: found?.name || member.user_email || "",
        avatar_url: found?.avatar_url ?? null,
        role: member.role,
        idp_managed: member.idp_managed,
      };
    }),
    total: roster.total,
    steward: dataStewardLabel(project.data_steward) || null,
    watchers,
  });
});
