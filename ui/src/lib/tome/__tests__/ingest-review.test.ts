import { shouldAwaitIngestReview, summarizeDraftFileReviews } from "../ingest-review";

describe("shouldAwaitIngestReview", () => {
  it("auto-completes a run when review is explicitly skipped", () => {
    expect(
      shouldAwaitIngestReview({
        skipReview: true,
        draftPaths: ["charter.md"],
      }),
    ).toBe(false);
  });

  it("auto-completes a run when the configured review mode produced no drafts", () => {
    expect(
      shouldAwaitIngestReview({
        skipReview: false,
        draftPaths: [],
      }),
    ).toBe(false);
  });

  it("waits for review when the run produced drafts", () => {
    expect(
      shouldAwaitIngestReview({
        skipReview: false,
        draftPaths: ["charter.md"],
      }),
    ).toBe(true);
  });

  it("never lets a received MyAgent reply bypass explicit review", () => {
    expect(
      shouldAwaitIngestReview({
        skipReview: true,
        draftPaths: [],
        forceReview: true,
      }),
    ).toBe(true);
  });
});

describe("summarizeDraftFileReviews", () => {
  it.each(["accept", "reject"] as const)("applies explicit bulk %s to every draft, replacing partial choices", (decision) => {
    const paths = ["first.md", "second.md"];
    expect(summarizeDraftFileReviews(
      ["second.md", "first.md", "first.md"],
      [{
        path: "first.md",
        decision: decision === "accept" ? "reject" : "accept",
        reviewed_by: "reviewer@example.test",
        reviewed_at: new Date("2026-01-01T00:00:00Z"),
      }, {
        path: "published.md",
        decision: "accept",
        reviewed_by: "reviewer@example.test",
        reviewed_at: new Date("2026-01-01T00:00:00Z"),
      }],
      decision,
    )).toEqual({
      acceptedPaths: decision === "accept" ? paths : [],
      rejectedPaths: decision === "reject" ? paths : [],
      pendingPaths: [],
    });
  });

  it("separates accepted, rejected, and pending files", () => {
    expect(summarizeDraftFileReviews(
      ["pending.md", "accepted.md", "rejected.md"],
      [
        {
          path: "accepted.md",
          decision: "accept",
          reviewed_by: "reviewer@example.test",
          reviewed_at: new Date("2026-01-01T00:00:00Z"),
        },
        {
          path: "rejected.md",
          decision: "reject",
          reviewed_by: "reviewer@example.test",
          reviewed_at: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    )).toEqual({
      acceptedPaths: ["accepted.md"],
      rejectedPaths: ["rejected.md"],
      pendingPaths: ["pending.md"],
    });
  });

  it("ignores decisions for files that are no longer pending drafts", () => {
    expect(summarizeDraftFileReviews(
      ["current.md"],
      [{
        path: "old.md",
        decision: "accept",
        reviewed_by: "reviewer@example.test",
        reviewed_at: new Date("2026-01-01T00:00:00Z"),
      }],
    )).toEqual({
      acceptedPaths: [],
      rejectedPaths: [],
      pendingPaths: ["current.md"],
    });
  });
});
