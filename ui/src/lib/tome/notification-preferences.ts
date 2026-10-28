import { FOLLOW_LEVELS, type FollowLevel } from "@/lib/tome/follow-levels";

/**
 * The shape of a reader's TOME notification preferences.
 *
 * Nothing here is stored or applied yet: the pipeline sends what it sends,
 * and these are the controls for deciding what it should send instead. They
 * live in their own module rather than inside the panel so that the options
 * a reader is offered, and the defaults they start from, are stated once and
 * can be read without reading a form.
 */

/** What a reader is offered for each space, in the order the menu lists it. */
export const SPACE_LEVELS = FOLLOW_LEVELS;
export type SpaceLevel = FollowLevel;

/** Where a notification can be put. */
export const CHANNELS = [
  { id: "bell", label: "App bell" },
  { id: "webex", label: "Webex" },
] as const;

export type Channel = (typeof CHANNELS)[number]["id"];

/** How often the ones a reader wants are gathered up and sent. */
export const CADENCES = [
  { id: "realtime", label: "Real-time" },
  { id: "daily", label: "Daily digest" },
  { id: "weekly", label: "Weekly digest" },
] as const;

export type Cadence = (typeof CADENCES)[number]["id"];

/** Hours of the day, as a reader picks them for quiet hours. */
export const HOURS = Array.from({ length: 24 }, (_unused, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, "0")}:00`,
}));

/**
 * A short list rather than every IANA zone: a long one is a scrolling
 * problem, and the reader's own is prepended below so theirs is always
 * present whether or not it is on the list.
 */
export const COMMON_TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

/** The reader's own zone first, then the rest, with no repeats. */
export function timezoneOptions(local: string): string[] {
  return [local, ...COMMON_TIMEZONES.filter((zone) => zone !== local)];
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export interface QuietHours {
  enabled: boolean;
  /** 0 to 23. */
  from: number;
  /** 0 to 23. */
  to: number;
  timezone: string;
}

/** What one space in the followed tree is set to. */
export interface SpacePreference {
  level: SpaceLevel;
  channels: Channel[];
  cadence: Cadence;
}

export interface TomeNotificationPreferences {
  enabled: boolean;
  level: SpaceLevel;
  channels: Channel[];
  cadence: Cadence;
  quietHours: QuietHours;
  /** Keyed by space slug; a space absent here follows the settings above. */
  spaces: Record<string, SpacePreference>;
}

export function defaultPreferences(timezone: string): TomeNotificationPreferences {
  return {
    enabled: true,
    level: "everything",
    channels: ["bell"],
    cadence: "realtime",
    quietHours: { enabled: false, from: 22, to: 7, timezone },
    spaces: {},
  };
}

/** What a space is set to, which is the global setting until it is changed. */
export function spacePreference(
  preferences: TomeNotificationPreferences,
  slug: string,
): SpacePreference {
  return preferences.spaces[slug] ?? {
    level: preferences.level,
    channels: preferences.channels,
    cadence: preferences.cadence,
  };
}

/**
 * How a column reads across several spaces at once: the shared value, or
 * "Mixed" when they disagree. The header controls show this so a reader can
 * see that a column is not uniform before they overwrite it.
 */
export function sharedValue<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const [first] = values;
  return values.every((value) => value === first) ? first : null;
}

/** "App bell, Webex", or "Off" when a reader has turned every channel off. */
export function channelsLabel(channels: readonly Channel[]): string {
  if (channels.length === 0) return "Off";
  return CHANNELS.filter((channel) => channels.includes(channel.id))
    .map((channel) => channel.label)
    .join(", ");
}

export function labelFor<T extends string>(
  options: readonly { id: T; label: string }[],
  id: T,
): string {
  return options.find((option) => option.id === id)?.label ?? id;
}
