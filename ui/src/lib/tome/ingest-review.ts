import type { IngestFileReview, IngestFileReviewDecision } from "@/types/tome";

/**
 * Decide whether a completed ingest must stop at the human-review gate.
 * An explicit per-run bypass wins; otherwise only runs that actually wrote
 * at least one draft have anything to review.
 */
export function shouldAwaitIngestReview(args: {
  skipReview: boolean;
  draftPaths: string[];
}): boolean {
  return !args.skipReview && args.draftPaths.length > 0;
}

export interface DraftFileReviewSummary {
  acceptedPaths: string[];
  rejectedPaths: string[];
  pendingPaths: string[];
}

/** Resolve draft decisions, optionally replacing them with an explicit bulk choice. */
export function summarizeDraftFileReviews(
  draftPaths: string[],
  reviews: IngestFileReview[] = [],
  bulkDecision?: IngestFileReviewDecision,
): DraftFileReviewSummary {
  const decisions = new Map(reviews.map((review) => [review.path, review.decision]));
  const paths = [...new Set(draftPaths)].sort();
  if (bulkDecision) {
    return {
      acceptedPaths: bulkDecision === "accept" ? paths : [],
      rejectedPaths: bulkDecision === "reject" ? paths : [],
      pendingPaths: [],
    };
  }
  return {
    acceptedPaths: paths.filter((path) => decisions.get(path) === "accept"),
    rejectedPaths: paths.filter((path) => decisions.get(path) === "reject"),
    pendingPaths: paths.filter((path) => !decisions.has(path)),
  };
}
