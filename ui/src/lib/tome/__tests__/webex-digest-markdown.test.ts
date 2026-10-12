import { buildDigestMarkdown } from "../webex-digest.server";

jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/in-app-notifications.server", () => ({
  notificationAudienceQuery: jest.fn(),
}));

const ORIGIN = "https://grid.example.com";

function entry(overrides: Partial<{
  title: string;
  actor: string;
  href: string;
  needsAttention: boolean;
}> = {}) {
  return {
    title: "Charter updated",
    needsAttention: false,
    ...overrides,
  };
}

const base = {
  entityTitle: "Example Project",
  entityHref: "/projects/example-project/tome?pane=summary",
  origin: ORIGIN,
};

describe("buildDigestMarkdown", () => {
  // A weekly message that reliably says "nothing happened" is the fastest
  // way to teach someone to filter the sender.
  it("sends nothing when there is nothing unread", () => {
    expect(buildDigestMarkdown({ ...base, entries: [] })).toBeNull();
  });

  it("leads with the entity and a count", () => {
    const markdown = buildDigestMarkdown({
      ...base,
      entries: [entry(), entry({ title: "Roadmap changed" })],
    });

    expect(markdown).toContain("**Example Project** — 2 unread updates");
  });

  it("does not pluralise a single update", () => {
    const markdown = buildDigestMarkdown({ ...base, entries: [entry()] });

    expect(markdown).toContain("1 unread update");
    expect(markdown).not.toContain("1 unread updates");
  });

  it("calls out how many need attention", () => {
    const markdown = buildDigestMarkdown({
      ...base,
      entries: [entry({ needsAttention: true }), entry()],
    });

    expect(markdown).toContain("2 unread updates, 1 needing attention");
  });

  it("names the author of each update", () => {
    const markdown = buildDigestMarkdown({
      ...base,
      entries: [entry({ actor: "Dana Okafor" })],
    });

    expect(markdown).toContain("· By Dana Okafor");
  });

  it("links each update absolutely, since a relative path is not clickable", () => {
    const markdown = buildDigestMarkdown({
      ...base,
      entries: [entry({ href: "/projects/example-project/tome/wiki/charter.md" })],
    });

    expect(markdown).toContain(
      `[Charter updated](${ORIGIN}/projects/example-project/tome/wiki/charter.md)`,
    );
  });

  // A half-written link is worse than a plain title, so with no configured
  // origin the digest still sends but stops pretending to link.
  it("falls back to plain titles when no public origin is configured", () => {
    const markdown = buildDigestMarkdown({
      ...base,
      origin: null,
      entries: [entry({ href: "/projects/example-project/tome/wiki/charter.md" })],
    });

    expect(markdown).toContain("- Charter updated");
    expect(markdown).not.toContain("](");
    expect(markdown).toContain("See what's new");
  });

  it("always offers a way back to the summary", () => {
    const markdown = buildDigestMarkdown({ ...base, entries: [entry()] });

    expect(markdown).toContain(
      `[See what's new](${ORIGIN}/projects/example-project/tome?pane=summary)`,
    );
  });

  describe("when there is more than fits", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      entry({ title: `Update ${index}` }),
    );

    it("lists the first fifteen and counts the rest", () => {
      const markdown = buildDigestMarkdown({ ...base, entries: many }) ?? "";

      expect(markdown).toContain("Update 0");
      expect(markdown).toContain("Update 14");
      expect(markdown).not.toContain("Update 15");
      expect(markdown).toContain("…and 5 more.");
    });

    it("still counts all of them in the heading", () => {
      const markdown = buildDigestMarkdown({ ...base, entries: many }) ?? "";

      expect(markdown).toContain("20 unread updates");
    });

    // Webex rejects anything longer, and the bot endpoint enforces it too.
    it("stays inside Webex's message limit", () => {
      const markdown = buildDigestMarkdown({ ...base, entries: many }) ?? "";

      expect(markdown.length).toBeLessThanOrEqual(4000);
    });
  });

  it("marks the rows to act on so they can be found by scanning", () => {
    const markdown = buildDigestMarkdown({
      ...base,
      entries: [entry({ needsAttention: true }), entry({ title: "Routine" })],
    }) ?? "";

    const urgent = markdown.split("\n").find((line) => line.includes("Charter"));
    const routine = markdown.split("\n").find((line) => line.includes("Routine"));
    expect(urgent).toMatch(/^- \u26a0\ufe0f /);
    expect(routine).toBe("- Routine");
  });
});
