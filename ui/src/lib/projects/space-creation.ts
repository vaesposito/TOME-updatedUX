/**
 * What the three steps of making a space add up to.
 *
 * Pure: the shape of the flow and the request it ends in, with no React and
 * no fetch, so the two things most easily got wrong — which steps a given
 * entry point has, and what a skipped step leaves behind — can be read and
 * tested without driving a dialog.
 */

import { normLabel } from "@/lib/projects/labels";
import {
  DEFAULT_SCHEDULE,
  scheduleToCron,
  type ScheduleFormState,
} from "@/lib/tome/auto-ingest/schedule-presets";
import type { DataStewardInput } from "@/types/projects";

/** A function and the divisions it keeps, for choosing a subject's place. */
export interface FunctionOption {
  name: string;
  categories: string[];
}

/** The kinds of space the flow can make. */
export type SpaceKind = "project" | "area" | "bhag" | "subject";

/**
 * Where a space lives.
 *
 * One concern, two axes, and a record only ever carries one of them: a
 * subject names a function and perhaps a category, a project names a BHAG
 * and perhaps an area. Which pair is in play is decided by the entry point,
 * so nothing here ever has to choose between them.
 */
export interface SpacePlacement {
  /** The function a subject will belong to. Absent on the hierarchy axis. */
  function?: string;
  /** The division of that function's work, when one was named. */
  category?: string;
  /** The BHAG a project or area sits under. Absent on the function axis. */
  initiative?: string;
  /** The area under that BHAG, when the project sits in one. */
  area?: string;
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

/**
 * The spelling already in use for a typed name, if there is one.
 *
 * A function and a category are not records: they exist because a subject
 * names them, and two subjects naming "Platform" and "platform" end up in two
 * groups that read as one. So a typed name that differs from an existing one
 * only in case or spacing is that existing name, and takes its spelling.
 *
 * Returns null when the name is genuinely new, which is also what tells the
 * form it has something to say to the writer.
 */
export function canonicalLabel(
  typed: string,
  existing: readonly string[],
): string | null {
  const key = normLabel(typed);
  if (!key) return null;
  return existing.find((name) => normLabel(name) === key) ?? null;
}

/**
 * The draft with its function and category settled against the vocabulary.
 *
 * Done at submit rather than while typing: rewriting the field under someone
 * mid-word is how you stop them reaching the name they meant.
 */
export function canonicalPlacement(
  draft: SpaceDraft,
  functionOptions: readonly FunctionOption[],
): SpaceDraft {
  const typedFunction = draft.placement?.function?.trim();
  if (!typedFunction) return draft;

  const names = functionOptions.map((option) => option.name);
  const fn = canonicalLabel(typedFunction, names) ?? typedFunction;

  const typedCategory = draft.placement?.category?.trim();
  const known = functionOptions.find((option) => normLabel(option.name) === normLabel(fn));
  const category = typedCategory
    ? (canonicalLabel(typedCategory, known?.categories ?? []) ?? typedCategory)
    : undefined;

  return { ...draft, placement: { ...draft.placement, function: fn, category } };
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
  /**
   * Who runs the space, named as `team:<slug>` or `user:<email>`. Empty until
   * the reader chooses, which is when the default below stands.
   */
  steward: string;
}

/** A steward written as one string, so one list can offer both kinds. */
export function stewardRef(steward: DataStewardInput): string {
  return steward.type === "team" ? `team:${steward.team_id}` : `user:${steward.email}`;
}

/** The same, read back. Null for anything that names neither kind. */
export function parseStewardRef(ref: string): DataStewardInput | null {
  const team = ref.startsWith("team:") ? ref.slice(5).trim() : "";
  if (team) return { type: "team", team_id: team };
  const email = ref.startsWith("user:") ? ref.slice(5).trim() : "";
  if (email) return { type: "user", email };
  return null;
}

/**
 * Who the third step can offer as steward: the owning team, and the people
 * invited there.
 *
 * Only those, because they are the only parties the step knows to be real. An
 * address typed in free-hand is one the reader cannot check and the endpoint
 * may well refuse — someone who has never signed in cannot hold the writer
 * relation a steward is.
 */
export function stewardChoices(draft: SpaceDraft): string[] {
  const refs = draft.teamSlug ? [`team:${draft.teamSlug}`] : [];
  for (const invite of draft.invitations) {
    if (invite.kind !== "user") continue;
    const subject = invite.subject.trim();
    if (subject && !refs.includes(`user:${subject}`)) refs.push(`user:${subject}`);
  }
  return refs;
}

/**
 * The person who may write to this space, as the endpoint wants it told.
 *
 * The reader's own pick, while it is still one of the choices: editing or
 * removing the person named drops it rather than sending an address nobody is
 * at any more.
 *
 * Unpicked, the first person invited as an admin, because naming someone an
 * admin of a space one is making is the plainest statement that they are to
 * run it. With nobody named, the owning team: a space has to have a steward
 * that resolves, and a team always does, where a single person may not have
 * signed in yet.
 */
export function stewardFor(draft: SpaceDraft): DataStewardInput {
  if (draft.steward && stewardChoices(draft).includes(draft.steward)) {
    const picked = parseStewardRef(draft.steward);
    if (picked) return picked;
  }
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

  if (draft.kind === "subject") {
    if (draft.placement?.function) {
      body.functions = [draft.placement.function];
      if (draft.placement.category) body.categories = [draft.placement.category];
    }
  } else if (draft.kind !== "bhag" && draft.placement?.initiative) {
    // The BHAG is named on the space itself even when an area is too, never
    // left to be inferred from the area: an area is not guaranteed to name
    // its own parent, and a project whose BHAG can only be reached through
    // one that does not is a project with no BHAG at all.
    body.initiatives = [draft.placement.initiative];
    // Only a project sits in an area. An area is one.
    if (draft.kind === "project" && draft.placement.area) {
      body.areas = [draft.placement.area];
    }
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
    steward: "",
  };
}
