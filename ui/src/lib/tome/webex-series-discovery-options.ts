/** Picker-only horizons. Background subscriptions retain their own horizon. */
export const WEBEX_SERIES_LOOKAHEAD_DAYS = [7, 14, 30] as const;
export type WebexSeriesLookaheadDays = typeof WEBEX_SERIES_LOOKAHEAD_DAYS[number];

export function occurrenceDiscoveryLabel(start: string | undefined, days: number, complete: boolean): string {
  if (start) return `${complete ? "Next" : "Next found"}: ${new Date(start).toLocaleString()}`;
  return complete
    ? `No upcoming occurrence found in the next ${days} days`
    : "Upcoming occurrence unknown — discovery incomplete";
}
