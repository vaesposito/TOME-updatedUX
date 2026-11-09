import {
  liveRevisions,
  readPageAuthor,
  readPageProvenance,
  readPageUpdate,
  relativeTime,
} from "@/lib/tome/page-provenance";

const NOW = new Date("2026-09-18T12:00:00.000Z");

describe("readPageAuthor", () => {
  it("names a person the way they are addressed, not by mailbox", () => {
    expect(readPageAuthor("test.user@example.com")).toEqual({
      kind: "person",
      name: "Test User",
    });
    expect(readPageAuthor("second-user@example.org")).toEqual({
      kind: "person",
      name: "Second User",
    });
  });

  it("keeps a handle that is already a name", () => {
    expect(readPageAuthor("Test User")).toEqual({ kind: "person", name: "Test User" });
  });

  it("tells the ingest apart from the agent and from a person", () => {
    expect(readPageAuthor("tome-ingest")).toEqual({ kind: "ingest", name: "ingest" });
    expect(readPageAuthor("tome")).toEqual({ kind: "agent", name: "Tome" });
  });

  it("falls back to the agent when nothing was recorded", () => {
    expect(readPageAuthor("   ")).toEqual({ kind: "agent", name: "Tome" });
  });
});

describe("readPageUpdate", () => {
  it("says a person edited the page", () => {
    expect(
      readPageUpdate(
        { author: "test.user@example.com", created_at: "2026-09-15T12:00:00.000Z" },
        NOW,
      ),
    ).toMatchObject({
      kind: "person",
      attribution: "Edited by Test User",
      when: "3d ago",
    });
  });

  it("says the ingest rewrote it, so the date reads as a regeneration", () => {
    expect(
      readPageUpdate(
        { author: "tome-ingest", created_at: "2026-09-18T10:00:00.000Z" },
        NOW,
      ),
    ).toMatchObject({ kind: "ingest", attribution: "Rewritten by ingest", when: "2h ago" });
  });

  it("credits Tome for an unattributed write", () => {
    expect(
      readPageUpdate({ author: "tome", created_at: "2026-09-18T11:59:30.000Z" }, NOW),
    ).toMatchObject({ kind: "agent", attribution: "Written by Tome", when: "just now" });
  });

  it("keeps the raw handle and instant for a closer look", () => {
    expect(
      readPageUpdate(
        { author: "test.user@example.com", created_at: "2026-09-15T12:00:00.000Z" },
        NOW,
      ),
    ).toMatchObject({
      author: "test.user@example.com",
      at: "2026-09-15T12:00:00.000Z",
    });
  });

  it("has nothing to say about a page with no revisions", () => {
    expect(readPageUpdate(null, NOW)).toBeNull();
  });
});

describe("liveRevisions", () => {
  const draft = {
    id: "draft",
    author: "tome-ingest",
    created_at: "2026-09-18T11:00:00.000Z",
    status: "draft",
  };
  const rejected = {
    id: "rejected",
    author: "tome-ingest",
    created_at: "2026-09-17T12:00:00.000Z",
    status: "rejected",
  };
  const removed = {
    id: "removed",
    author: "test.user@example.com",
    created_at: "2026-09-16T12:00:00.000Z",
    deleted: true,
  };
  const live = {
    id: "live",
    author: "test.user@example.com",
    created_at: "2026-09-15T12:00:00.000Z",
    status: "live",
  };

  it("drops what no reader is looking at", () => {
    expect(liveRevisions([draft, rejected, removed, live]).map((r) => r.id)).toEqual([
      "live",
    ]);
  });

  it("treats a revision from before review as live", () => {
    const old = { id: "old", author: "tome", created_at: "2026-09-14T12:00:00.000Z" };
    expect(liveRevisions([old]).map((r) => r.id)).toEqual(["old"]);
  });

  it("puts the newest first whatever order it arrived in", () => {
    const older = { id: "older", author: "tome", created_at: "2026-09-01T12:00:00.000Z" };
    const newer = { id: "newer", author: "tome", created_at: "2026-09-09T12:00:00.000Z" };
    expect(liveRevisions([older, newer]).map((r) => r.id)).toEqual(["newer", "older"]);
  });
});

describe("readPageProvenance", () => {
  it("credits the live revision, never a draft awaiting review", () => {
    const provenance = readPageProvenance(
      [
        {
          id: "draft",
          author: "tome-ingest",
          created_at: "2026-09-18T11:00:00.000Z",
          status: "draft",
        },
        {
          id: "live",
          author: "test.user@example.com",
          created_at: "2026-09-15T12:00:00.000Z",
          status: "live",
        },
      ],
      NOW,
    );
    expect(provenance?.latest).toMatchObject({
      attribution: "Edited by Test User",
      when: "3d ago",
    });
  });

  it("keeps the last human edit when the agent has written since", () => {
    const provenance = readPageProvenance(
      [
        { id: "a", author: "tome-ingest", created_at: "2026-09-18T10:00:00.000Z" },
        { id: "b", author: "test.user@example.com", created_at: "2026-09-15T12:00:00.000Z" },
        { id: "c", author: "tome-ingest", created_at: "2026-09-01T12:00:00.000Z" },
      ],
      NOW,
    );
    expect(provenance?.latest.attribution).toBe("Rewritten by ingest");
    expect(provenance?.lastEdit).toMatchObject({
      attribution: "Edited by Test User",
      when: "3d ago",
    });
  });

  it("says a person's edit once when it is also the latest change", () => {
    const provenance = readPageProvenance(
      [{ id: "a", author: "test.user@example.com", created_at: "2026-09-15T12:00:00.000Z" }],
      NOW,
    );
    expect(provenance?.lastEdit).toBeNull();
  });

  it("has no human edit to report on a page only the agent has written", () => {
    const provenance = readPageProvenance(
      [{ id: "a", author: "tome-ingest", created_at: "2026-09-18T10:00:00.000Z" }],
      NOW,
    );
    expect(provenance?.lastEdit).toBeNull();
  });

  it("has nothing to say when every revision is a draft", () => {
    expect(
      readPageProvenance(
        [
          {
            id: "draft",
            author: "tome-ingest",
            created_at: "2026-09-18T11:00:00.000Z",
            status: "draft",
          },
        ],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("relativeTime", () => {
  it("grows its unit with the gap", () => {
    expect(relativeTime("2026-09-18T11:59:30.000Z", NOW)).toBe("just now");
    expect(relativeTime("2026-09-18T11:45:00.000Z", NOW)).toBe("15m ago");
    expect(relativeTime("2026-09-18T07:00:00.000Z", NOW)).toBe("5h ago");
    expect(relativeTime("2026-09-10T12:00:00.000Z", NOW)).toBe("8d ago");
    expect(relativeTime("2026-07-01T12:00:00.000Z", NOW)).toBe("2mo ago");
    expect(relativeTime("2024-09-18T12:00:00.000Z", NOW)).toBe("2y ago");
  });
});
