import { splitHomeFeeds } from "@/components/tome/home/home-feeds";
import type {
  TomeSummary,
  TomeSummaryItem,
  TomeSummarySection,
  TomeSummarySectionKey,
} from "@/types/tome-summary";

function item(
  id: string,
  overrides: Partial<TomeSummaryItem> = {},
): TomeSummaryItem {
  return {
    id,
    title: id,
    message: "",
    category: "update",
    severity: "info",
    event_label: "",
    entity_slug: "example-project",
    entity_title: "Example Project",
    entity_type: "project",
    created_at: "2026-10-10T12:00:00.000Z",
    open_days: 0,
    read: false,
    needs_attention: false,
    resolved: false,
    reason: "in_scope",
    following: true,
    ...overrides,
  };
}

function summary(
  sections: { key: TomeSummarySectionKey; items: TomeSummaryItem[] }[],
): TomeSummary {
  return {
    entity: { slug: "example-project", title: "Example Project", type: "project" },
    scope_entities: [],
    scope: "all",
    headline: "",
    counts: {
      attention: 0,
      decided: 0,
      open_decisions: 0,
      team: 0,
      elsewhere: 0,
      wiki: 0,
      descendants: 0,
      recently_resolved: 0,
      unread: 0,
    },
    sections: sections.map(
      ({ key, items }): TomeSummarySection => ({
        key,
        title: key,
        description: "",
        items,
        total: items.length,
      }),
    ),
    since: "2026-10-01T00:00:00.000Z",
    generated_at: "2026-10-12T00:00:00.000Z",
  };
}

describe("splitHomeFeeds", () => {
  it("sends a mention to Tagged and nowhere else", () => {
    const feeds = splitHomeFeeds(
      summary([{ key: "team", items: [item("a", { reason: "mentioned" })] }]),
    );
    expect(feeds.tagged.map((i) => i.id)).toEqual(["a"]);
    expect(feeds.attention).toEqual([]);
    expect(feeds.updates).toEqual([]);
  });

  it("keeps a mention in Tagged even when it also needs attention", () => {
    const feeds = splitHomeFeeds(
      summary([
        { key: "attention", items: [item("a", { reason: "mentioned", needs_attention: true })] },
      ]),
    );
    expect(feeds.tagged.map((i) => i.id)).toEqual(["a"]);
    expect(feeds.attention).toEqual([]);
  });

  it("treats an open decision as needing attention", () => {
    const feeds = splitHomeFeeds(
      summary([{ key: "open_decisions", items: [item("a")] }]),
    );
    expect(feeds.attention.map((i) => i.id)).toEqual(["a"]);
    expect(feeds.updates).toEqual([]);
  });

  it("treats an error as needing attention wherever it was filed", () => {
    const feeds = splitHomeFeeds(
      summary([{ key: "elsewhere", items: [item("a", { severity: "error" })] }]),
    );
    expect(feeds.attention.map((i) => i.id)).toEqual(["a"]);
  });

  it("returns a settled item to the record rather than asking for action", () => {
    const feeds = splitHomeFeeds(
      summary([
        { key: "attention", items: [item("a", { needs_attention: true, resolved: true })] },
      ]),
    );
    expect(feeds.attention).toEqual([]);
    expect(feeds.updates.map((i) => i.id)).toEqual(["a"]);
  });

  it("counts an item filed under several sections only once", () => {
    const shared = item("a");
    const feeds = splitHomeFeeds(
      summary([
        { key: "team", items: [shared] },
        { key: "elsewhere", items: [shared] },
        { key: "wiki", items: [shared] },
      ]),
    );
    expect(feeds.updates.map((i) => i.id)).toEqual(["a"]);
    expect(feeds.tagged).toEqual([]);
    expect(feeds.attention).toEqual([]);
  });

  it("lets any one of an item's sections make it pressing", () => {
    const shared = item("a");
    const feeds = splitHomeFeeds(
      summary([
        { key: "wiki", items: [shared] },
        { key: "open_decisions", items: [shared] },
      ]),
    );
    expect(feeds.attention.map((i) => i.id)).toEqual(["a"]);
    expect(feeds.updates).toEqual([]);
  });

  it("orders every card newest first", () => {
    const feeds = splitHomeFeeds(
      summary([
        {
          key: "elsewhere",
          items: [
            item("older", { created_at: "2026-10-01T00:00:00.000Z" }),
            item("newest", { created_at: "2026-10-11T00:00:00.000Z" }),
            item("middle", { created_at: "2026-10-05T00:00:00.000Z" }),
          ],
        },
      ]),
    );
    expect(feeds.updates.map((i) => i.id)).toEqual(["newest", "middle", "older"]);
  });

  it("keeps a row with an unreadable date rather than dropping it", () => {
    const feeds = splitHomeFeeds(
      summary([
        {
          key: "elsewhere",
          items: [item("dated"), item("undated", { created_at: "not a date" })],
        },
      ]),
    );
    expect(feeds.updates.map((i) => i.id)).toEqual(["dated", "undated"]);
  });

  it("reports three empty cards for a space with nothing in it", () => {
    expect(splitHomeFeeds(summary([]))).toEqual({
      tagged: [],
      attention: [],
      updates: [],
    });
  });

  it("reports three empty cards before the summary has loaded", () => {
    expect(splitHomeFeeds(null)).toEqual({
      tagged: [],
      attention: [],
      updates: [],
    });
  });
});
