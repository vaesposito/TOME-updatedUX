/**
 * How much of a space's traffic a reader wants.
 *
 * Only the ends of this scale are wired to anything: "off" is not following,
 * and the other three are following. Which of the three is a presentational
 * choice for now, because nothing downstream classifies a notification as
 * important or as a mention yet. The scale is modelled here rather than
 * inline so that the day something does, there is one place that says what
 * the levels are and one place to teach the pipeline about them.
 */
export const FOLLOW_LEVELS = [
  {
    id: "everything",
    label: "Everything",
    hint: "Every edit, ingest, and update",
  },
  {
    id: "important",
    label: "Important",
    hint: "Decisions, critical items, milestones",
  },
  {
    id: "mentions",
    label: "Mentions",
    hint: "Only when you're named or assigned",
  },
  {
    id: "off",
    label: "Off",
    hint: "Nothing from here",
  },
] as const;

export type FollowLevel = (typeof FOLLOW_LEVELS)[number]["id"];

export const DEFAULT_FOLLOW_LEVEL: FollowLevel = "everything";

/** Whether a level means the reader hears anything at all. */
export function isFollowing(level: FollowLevel): boolean {
  return level !== "off";
}

/** The summary under the menu's heading, and the button's own label. */
export function followLevelSummary(level: FollowLevel): string {
  if (level === "off") return "Not following";
  const found = FOLLOW_LEVELS.find((entry) => entry.id === level);
  return `Following · ${found?.label ?? "Everything"}`;
}

/**
 * The level a plain subscription means.
 *
 * Watching is stored as a yes or no, so a reader who is watching is treated
 * as wanting everything — the loudest reading, which is the safe one: it
 * shows them what they are already being sent rather than implying a filter
 * that is not being applied.
 */
export function levelFromWatching(watching: boolean): FollowLevel {
  return watching ? DEFAULT_FOLLOW_LEVEL : "off";
}
