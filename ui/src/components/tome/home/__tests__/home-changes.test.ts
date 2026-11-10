import {
  CHANGES_WINDOW_MS,
  collapseChanges,
  type FeedEvent,
} from "../home-changes";

const NOW = Date.parse("2026-03-12T12:00:00.000Z");

function event(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id: "m1",
    content: "Something happened",
    message_type: "event",
    created_at: new Date(NOW - 60_000).toISOString(),
    metadata: { kind: "source_event" },
    ...overrides,
  };
}

describe("collapseChanges", () => {
  it("keeps only the last seven days", () => {
    const rows = collapseChanges(
      [
        event({ id: "recent", content: "This week" }),
        event({
          id: "old",
          content: "Last month",
          created_at: new Date(NOW - CHANGES_WINDOW_MS - 1).toISOString(),
        }),
      ],
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(["recent"]);
  });

  it("leaves conversation out of the record of what changed", () => {
    const rows = collapseChanges(
      [
        event({ id: "chat", message_type: "broadcast", metadata: null }),
        event({ id: "activity" }),
      ],
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(["activity"]);
  });

  it("reads one run's transitions as one change, at its latest word", () => {
    const rows = collapseChanges(
      [
        event({
          id: "started",
          content: "Ingest started",
          created_at: new Date(NOW - 3_600_000).toISOString(),
          metadata: { kind: "ingest_event", correlation_id: "run-1" },
        }),
        event({
          id: "finished",
          content: "Ingest completed — awaiting review",
          created_at: new Date(NOW - 600_000).toISOString(),
          metadata: { kind: "ingest_event", correlation_id: "run-1" },
        }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Ingest completed — awaiting review");
    expect(rows[0].collapsed).toBe(2);
  });

  it("keeps two runs apart", () => {
    const rows = collapseChanges(
      [
        event({ id: "a", metadata: { kind: "ingest_event", correlation_id: "run-1" } }),
        event({ id: "b", metadata: { kind: "ingest_event", correlation_id: "run-2" } }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(2);
  });

  it("orders the newest change first whatever order the feed arrived in", () => {
    const rows = collapseChanges(
      [
        event({ id: "older", created_at: new Date(NOW - 7_200_000).toISOString() }),
        event({ id: "newer", created_at: new Date(NOW - 60_000).toISOString() }),
      ],
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(["newer", "older"]);
  });

  it("names the repository a source event came from, and invents nothing else", () => {
    const rows = collapseChanges(
      [
        event({
          id: "pr",
          metadata: { kind: "source_event", payload: { repo: "example-org/example-repo" } },
        }),
        event({ id: "run", metadata: { kind: "ingest_event", payload: { mode: "ingest" } } }),
      ],
      NOW,
    );
    expect(rows.find((row) => row.id === "pr")?.detail).toBe(
      "example-org/example-repo",
    );
    expect(rows.find((row) => row.id === "run")?.detail).toBeUndefined();
  });

  it("does not let an unreadable timestamp reorder the list", () => {
    const rows = collapseChanges(
      [event({ id: "broken", created_at: "not a date" }), event({ id: "fine" })],
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(["fine"]);
  });
});
