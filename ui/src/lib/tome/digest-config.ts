/**
 * What a reader asked their digest to cover, and when to write it.
 *
 * Stored on the reader rather than on a space: the digest spans everything
 * they can see, so there is no one space it would belong to, and a reader
 * who moves between portfolios should not have to say it again.
 *
 * Nothing writes a digest yet. Keeping the choices anyway means the form
 * remembers, and means whatever eventually runs has something to read rather
 * than a schedule invented at the point of writing.
 */

export const DIGEST_FREQUENCIES = [
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "fortnightly", label: "Every two weeks" },
] as const;

export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number]["value"];

/** Sunday first, matching `Date.prototype.getDay`. */
export const DIGEST_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface DigestConfig {
  /** What the reader asked to be told about, in their own words. */
  topic: string;
  frequency: DigestFrequency;
  /** 0 Sunday to 6 Saturday. Carried but unused while the digest is daily. */
  weekday: number;
  /** 0 to 23, read in whatever timezone the reader's browser reports. */
  hour: number;
}

/**
 * Monday morning, which is when a week is worth summarising.
 *
 * Early enough to be read before the week is decided, and late enough that
 * it covers the whole of the one before.
 */
export const DEFAULT_DIGEST_CONFIG: DigestConfig = {
  topic: "",
  frequency: "weekly",
  weekday: 1,
  hour: 9,
};

/**
 * How long a topic may be.
 *
 * A sentence or two about what to watch, not a document. The cap is here
 * rather than only in the textarea because the settings endpoint stores what
 * it is sent, and a field with no ceiling is a way to grow someone's
 * settings document without limit.
 */
export const DIGEST_TOPIC_MAX = 600;

/** Whether a day of the week means anything at this frequency. */
export function usesWeekday(frequency: DigestFrequency): boolean {
  return frequency !== "daily";
}

/** "9 AM", "12 PM", "12 AM" — the clock most people read a schedule in. */
export function hourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${period}`;
}

/** The whole schedule in one line: "Every week on Monday at 9 AM". */
export function describeDigest(config: DigestConfig): string {
  const frequency =
    DIGEST_FREQUENCIES.find((entry) => entry.value === config.frequency)
      ?.label ?? "Every week";
  const when = usesWeekday(config.frequency)
    ? ` on ${DIGEST_WEEKDAYS[config.weekday] ?? "Monday"}`
    : "";
  return `${frequency}${when} at ${hourLabel(config.hour)}`;
}

/**
 * Read a configuration out of whatever was stored.
 *
 * Every field is taken on its own merits, so a document written by an older
 * release — or edited by hand — gives up the parts that still make sense
 * instead of being thrown away whole and silently resetting the lot.
 */
export function parseDigestConfig(value: unknown): DigestConfig {
  if (!value || typeof value !== "object") return DEFAULT_DIGEST_CONFIG;
  const raw = value as Record<string, unknown>;

  const frequency = DIGEST_FREQUENCIES.some(
    (entry) => entry.value === raw.frequency,
  )
    ? (raw.frequency as DigestFrequency)
    : DEFAULT_DIGEST_CONFIG.frequency;

  const weekday =
    typeof raw.weekday === "number" &&
    Number.isInteger(raw.weekday) &&
    raw.weekday >= 0 &&
    raw.weekday <= 6
      ? raw.weekday
      : DEFAULT_DIGEST_CONFIG.weekday;

  const hour =
    typeof raw.hour === "number" &&
    Number.isInteger(raw.hour) &&
    raw.hour >= 0 &&
    raw.hour <= 23
      ? raw.hour
      : DEFAULT_DIGEST_CONFIG.hour;

  return {
    topic:
      typeof raw.topic === "string"
        ? raw.topic.slice(0, DIGEST_TOPIC_MAX)
        : DEFAULT_DIGEST_CONFIG.topic,
    frequency,
    weekday,
    hour,
  };
}

/** Whether anything has been changed since it was last read or written. */
export function digestConfigsDiffer(
  one: DigestConfig,
  other: DigestConfig,
): boolean {
  return (
    one.topic.trim() !== other.topic.trim() ||
    one.frequency !== other.frequency ||
    one.hour !== other.hour ||
    // A day the frequency does not use is not a difference worth enabling
    // Save for: nothing a reader can see would change.
    (usesWeekday(one.frequency) && one.weekday !== other.weekday)
  );
}
