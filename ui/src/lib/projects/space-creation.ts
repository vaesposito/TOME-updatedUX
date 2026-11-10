/**
 * What the three steps of making a space add up to.
 *
 * Pure: the shape of the flow and the request it ends in, with no React and
 * no fetch, so the two things most easily got wrong — which steps a given
 * entry point has, and what a skipped step leaves behind — can be read and
 * tested without driving a dialog.
 */

import {
  DEFAULT_SCHEDULE,
  scheduleToCron,
  type ScheduleFormState,
} from "@/lib/tome/auto-ingest/schedule-presets";

/** A function and the divisions it keeps, for choosing a subject's place. */
export interface FunctionOption {
  name: string;
  categories: string[];
}

/** The kinds of space the flow can make. */
export type SpaceKind = "project" | "area" | "bhag" | "subject";

/** Where the flow was opened from, which decides what it can make. */
export interface SpacePlacement {
  /** The function a subject will belong to. Absent on the hierarchy axis. */
  function?: string;
  /** The division of that function's work, when one was named. */
  category?: string;
}

/**
 * The kinds on offer, given where the flow was opened.
 *
 * A flow opened from the function axis is making a subject and can make
 * nothing else: that axis has one kind of leaf, and offering BHAG there
 * would be offering to put a record on the other axis. Opened from the
 * catalogue, the three hierarchy kinds are all available, as they were.
 */
export function kindsFor(placement: SpacePlacement | undefined): SpaceKind[] {
  return placement?.function ? ["subject"] : ["project", "area", "bhag"];
}

/** What a reader can name as a source here. */
export type SourceKind = "github" | "confluence" | "webex" | "sharepoint";

export interface PickedSource {
  id: string;
  kind: SourceKind;
  /** A repository's full name, a space key, a room name — as typed. */
  value: string;
}

/**
 * Which picked sources the create call can actually carry.
 *
 * Only repositories. `github_repos` is a list of plain names and nothing has
 * to be resolved for one to mean something; the other three are stored as
 * objects that the real pickers build out of a chosen space, room or
 * document, and a hand-typed name is not one of those. So the rest are a
 * record of what the reader wants, kept in the dialog and attached properly
 * in the space's own settings afterwards.
 */
export function sentSources(sources: readonly PickedSource[]): string[] {
  return sources
    .filter((source) => source.kind === "github" && source.value.trim())
    .map((source) => source.value.trim());
}

/**
 * The weekly default, as a form the schedule editor can take.
 *
 * Once a week rather than the daily the rest of TOME starts from: a space
 * made with its sources attached should refresh itself without being asked,
 * and weekly is the rate at which that is worth a reader's attention.
 */
export const WEEKLY_SCHEDULE: ScheduleFormState = {
  ...DEFAULT_SCHEDULE,
  preset: "weekly",
};

/** One invitation collected in the third step. */
export interface Invitation {
  id: string;
  kind: "group" | "user";
  /** A team slug, or an email address. */
  subject: string;
  /** Admin is the elevated one; `member` is the plain, non-admin role. */
  role: "admin" | "member";
}

export interface SpaceDraft {
  kind: SpaceKind;
  name: string;
  description: string;
  placement?: SpacePlacement;
  /** The team the space belongs to, which is also its first group. */
  teamSlug: string;
  /** Left empty when the sources step is skipped. */
  sources: PickedSource[];
  /** Off only when the sources step was skipped or switched off by hand. */
  scheduleEnabled: boolean;
  schedule: ScheduleFormState;
  invitations: Invitation[];
}

/**
 * The person who may write to this space, as the endpoint wants it told.
 *
 * The first person invited as an admin, because naming someone an admin of a
 * space one is making is the plainest statement that they are to run it. With
 * nobody named, the owning team: a space has to have a steward that resolves,
 * and a team always does, where a single person may not have signed in yet.
 */
export function stewardFor(draft: SpaceDraft):
  | { type: "user"; email: string }
  | { type: "team"; team_id: string } {
  const admin = draft.invitations.find(
    (invite) => invite.kind === "user" && invite.role === "admin" && invite.subject.trim(),
  );
  return admin
    ? { type: "user", email: admin.subject.trim() }
    : { type: "team", team_id: draft.teamSlug };
}

/**
 * The invitations left for after the space exists.
 *
 * Everything the create call did not already say: the steward is carried on
 * the space itself, and the owning team is the `team_id`, so neither is sent
 * twice.
 */
export function invitationsToSend(draft: SpaceDraft): Invitation[] {
  const steward = stewardFor(draft);
  return draft.invitations.filter((invite) => {
    if (!invite.subject.trim()) return false;
    if (invite.kind === "group") return invite.subject !== draft.teamSlug;
    return !(steward.type === "user" && invite.subject.trim() === steward.email);
  });
}

/**
 * The body POSTed to /api/projects.
 *
 * A subject is a project with a function on it: the endpoint has one kind of
 * leaf space, and which axis it sits on is said by the labels rather than by
 * a second type. Skipping the sources step leaves nothing attached and no
 * `auto_ingest` at all, which is the difference between a space that was
 * never given a schedule and one that was given a disabled one.
 */
export function createRequestFrom(draft: SpaceDraft): Record<string, unknown> {
  const repos = sentSources(draft.sources);
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    type: draft.kind === "subject" ? "project" : draft.kind,
    team_id: draft.teamSlug,
    data_steward: stewardFor(draft),
    github_repos: repos,
  };

  if (draft.kind === "subject" && draft.placement?.function) {
    body.functions = [draft.placement.function];
    if (draft.placement.category) body.categories = [draft.placement.category];
  }

  // A schedule only means something over something to read.
  if (draft.scheduleEnabled && repos.length > 0) {
    body.auto_ingest = {
      enabled: true,
      cron: scheduleToCron(draft.schedule),
    };
  }

  return body;
}

/** A draft with nothing in it yet, for the entry point given. */
export function emptyDraft(placement?: SpacePlacement): SpaceDraft {
  return {
    kind: kindsFor(placement)[0],
    name: "",
    description: "",
    placement,
    teamSlug: "",
    sources: [],
    scheduleEnabled: true,
    schedule: WEEKLY_SCHEDULE,
    invitations: [],
  };
}
