/**
 * Where a reader's Tome notifications go in Webex, and how often.
 *
 * One rule per watched entity, because that is the unit people actually think
 * in: a project whose every change matters belongs in a team space, while
 * three others they merely keep an eye on belong in one digest a week. A
 * single account-wide setting cannot say that.
 *
 * Rules are per reader, not per project. Two people watching the same project
 * route it to different places, and neither can see or change the other's
 * choice.
 */

import type { ProjectType } from "@/types/projects";

/**
 * Where messages land.
 *
 * `off` is a real state rather than the absence of a rule: a reader who has
 * deliberately silenced a noisy project should not have that read as "never
 * configured" and be offered the default again.
 */
export type WebexDeliveryDestination = "off" | "direct" | "space";

/**
 * How often, which is the difference between a notification and an
 * interruption.
 *
 * `immediate` sends as changes happen. The other two collect and send once,
 * which is the only way to watch a busy project without it costing attention
 * all day.
 */
export type WebexDeliveryCadence = "immediate" | "daily" | "weekly";

export interface WebexDeliveryRule {
  entity_slug: string;
  entity_title: string;
  entity_type: ProjectType;
  destination: WebexDeliveryDestination;
  /** The space to post in. Required when `destination` is `space`. */
  space_id?: string;
  /**
   * The space's name as it was when chosen, for display.
   *
   * Stored rather than looked up so that listing the rules costs no Webex
   * calls — and so a space the bot has since been removed from still reads
   * as a name the reader recognises instead of an opaque id.
   */
  space_name?: string;
  cadence: WebexDeliveryCadence;
  /**
   * Hour of the day a digest goes out, 0–23, in `timezone`.
   *
   * Ignored when the cadence is `immediate`, but kept rather than cleared so
   * that switching to a digest and back does not lose the chosen time.
   */
  hour: number;
  /** Day a weekly digest goes out, 0 = Sunday. */
  weekday: number;
  /**
   * The IANA zone `hour` is meant in, e.g. `Europe/Rome`.
   *
   * Recorded from the reader's own browser when they set the rule. A digest
   * promised for 9am has to arrive at their 9am, and the server's clock is
   * not evidence of that.
   */
  timezone: string;
}

/** A space the bot can post to, for the destination picker. */
export interface WebexDeliverySpace {
  id: string;
  name: string;
}

/**
 * Whether Webex delivery can work at all, and if not, why.
 *
 * Reported to the client so the tab can explain itself. Delivery depends on a
 * bot service that is deployed separately, and a settings page that silently
 * saves rules nothing will ever act on is worse than one that says so.
 */
export interface WebexDeliveryCapability {
  available: boolean;
  /** Shown to the reader when `available` is false. */
  reason?: string;
}

export interface WebexDeliverySettings {
  capability: WebexDeliveryCapability;
  /** One per watched entity, including the ones still set to `off`. */
  rules: WebexDeliveryRule[];
}

export const DEFAULT_WEBEX_DELIVERY_HOUR = 9;
/** Monday: a weekly digest is for planning the week, not closing it. */
export const DEFAULT_WEBEX_DELIVERY_WEEKDAY = 1;

export const WEBEX_DELIVERY_CADENCE_LABELS: Record<WebexDeliveryCadence, string> = {
  immediate: "As it happens",
  daily: "Daily digest",
  weekly: "Weekly digest",
};

export const WEBEX_DELIVERY_DESTINATION_LABELS: Record<
  WebexDeliveryDestination,
  string
> = {
  off: "Off",
  direct: "Direct message",
  space: "A space",
};

export const WEBEX_WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
