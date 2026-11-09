/**
 * What a project's own record says about who keeps it and how current it is.
 *
 * Four questions a reader asks of any wiki before trusting it — who owns
 * this, when did it last change, does it keep itself up to date, and can I
 * rely on it today — answered from the project document alone so every
 * surface answers them the same way.
 *
 * Pure: no React, no fetch. The dates come in, a reading comes out.
 */

import { humanizeCron } from "@/lib/cron-humanize";
import { dataStewardLabel, type ProjectDocument } from "@/types/projects";

/** A week, after which content that should refresh is worth a second look. */
const AGEING_DAYS = 7;
/** A month, after which it is out of date rather than merely ageing. */
const STALE_DAYS = 30;

export interface ProjectOwner {
  name: string;
  /** Whether a team holds it or one person does, which read differently. */
  kind: "team" | "user" | "none";
}

export type UpdateMode =
  /** Kept current on a schedule, in the schedule's own words. */
  | { kind: "scheduled"; phrase: string }
  /** Has sources but nobody has told it when to read them. */
  | { kind: "on-demand" }
  /** Written by hand; nothing to refresh from. */
  | { kind: "manual" };

export interface Staleness {
  /** `stale` is out of date; `ageing` is worth a look but not yet wrong. */
  level: "stale" | "ageing";
  /** Said in full, because a colour alone does not say why. */
  reason: string;
}

export interface ProjectFreshness {
  owner: ProjectOwner;
  /** When the agent last read the sources, and when a person last wrote. */
  ingested: Date | null;
  edited: Date | null;
  updates: UpdateMode;
  /** Null when there is nothing to warn about. */
  stale: Staleness | null;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / 86_400_000;
}

/** Whether anything is attached for the agent to read. */
export function hasSources(project: Pick<ProjectDocument, "sources">): boolean {
  const sources = project.sources;
  if (!sources) return false;
  return (
    (sources.github_repos?.length ?? 0) > 0 ||
    (sources.repos?.length ?? 0) > 0 ||
    (sources.confluence_spaces?.length ?? 0) > 0 ||
    Boolean(sources.confluence_url) ||
    (sources.webex_rooms?.length ?? 0) > 0 ||
    (sources.sharepoint_documents?.length ?? 0) > 0
  );
}

export function readOwner(
  project: Pick<ProjectDocument, "data_steward" | "team_name">,
): ProjectOwner {
  const steward = project.data_steward;
  const named = dataStewardLabel(steward).trim();
  if (named) {
    const kind =
      typeof steward === "object" && steward?.type === "team" ? "team" : "user";
    return { name: named, kind };
  }
  // The team is who to ask when nobody has been named, so it is said as
  // such rather than left blank: a reader needs someone to go to.
  const team = project.team_name?.trim();
  return team ? { name: team, kind: "team" } : { name: "", kind: "none" };
}

export function readUpdateMode(
  project: Pick<ProjectDocument, "autoIngest" | "sources">,
): UpdateMode {
  const auto = project.autoIngest;
  if (auto?.enabled && auto.cron) {
    const phrase = humanizeCron(auto.cron);
    // Without a phrase for the expression, the fact that it is scheduled is
    // still worth saying; the expression itself would not help a reader.
    return { kind: "scheduled", phrase: phrase ?? "On a schedule" };
  }
  return hasSources(project) ? { kind: "on-demand" } : { kind: "manual" };
}

/**
 * Whether the wiki can be relied on today.
 *
 * Only asked of a project with something to refresh from. A hand-written
 * wiki is not stale for having gone a month without an edit — that is what a
 * finished page looks like — so age alone is never the complaint there.
 */
export function readStaleness(
  project: Pick<
    ProjectDocument,
    "autoIngest" | "sources" | "last_source_event_at"
  > & {
    last_ingested_at?: string | Date | null;
  },
  now: Date = new Date(),
): Staleness | null {
  const updates = readUpdateMode(project);
  if (updates.kind === "manual") return null;

  const ingested = toDate(project.last_ingested_at);
  if (!ingested) {
    return {
      level: "stale",
      reason: "Sources are attached but have never been read.",
    };
  }

  // Something moved at the source after the last read, which makes the wiki
  // wrong in a way no amount of recency can excuse.
  const event = toDate(project.last_source_event_at);
  if (event && event.getTime() > ingested.getTime()) {
    return {
      level: "stale",
      reason: "A source has changed since this was last read.",
    };
  }

  const age = daysSince(ingested, now);
  if (age >= STALE_DAYS) {
    return { level: "stale", reason: "Sources have not been read in a month." };
  }
  if (age >= AGEING_DAYS) {
    return { level: "ageing", reason: "Sources have not been read in a week." };
  }
  return null;
}

export function readFreshness(
  project: Parameters<typeof readStaleness>[0] &
    Pick<ProjectDocument, "data_steward" | "team_name"> & {
      last_edited_at?: string | Date | null;
    },
  now: Date = new Date(),
): ProjectFreshness {
  return {
    owner: readOwner(project),
    ingested: toDate(project.last_ingested_at),
    edited: toDate(project.last_edited_at),
    updates: readUpdateMode(project),
    stale: readStaleness(project, now),
  };
}
