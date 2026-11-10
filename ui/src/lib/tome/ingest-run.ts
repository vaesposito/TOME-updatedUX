/**
 * How a space is brought up to date, and what to say while it is being.
 *
 * Two kinds of space refresh in two different ways, and more than one surface
 * offers to do it — the ingest panel, which asks what sort of run to make,
 * and the space header, which only offers the ordinary one. They agree here
 * so that neither can drift from the other.
 *
 * Pure: no fetching, no state.
 */

/** A run that has not finished, as the ingest list reports it. */
export type IngestRunStatus =
  | "queued"
  | "running"
  | "awaiting_review"
  | "succeeded"
  | "failed";

/**
 * Which route refreshes this space.
 *
 * A BHAG or an Area has no sources of its own worth reading: what it says is
 * a roll-up of the spaces tagged into it, so it synthesizes. A project or a
 * subject reads the sources it is actually attached to.
 */
export function ingestEndpoint(isSynthesized: boolean): "synthesize" | "reingest" {
  return isSynthesized ? "synthesize" : "reingest";
}

/** Whether this run is one that a second run should wait for. */
export function isRunInFlight(status: IngestRunStatus): boolean {
  return status === "running" || status === "queued";
}

/**
 * What a run in flight is doing, in the catalogue's own words.
 *
 * Started and merely accepted are different facts to someone wondering
 * whether to wait, and the project card already tells them apart.
 */
export function inFlightLabel(status: IngestRunStatus): string {
  return status === "running" ? "Ingesting" : "Queued";
}
