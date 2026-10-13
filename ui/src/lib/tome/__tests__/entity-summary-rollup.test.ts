/**
 * What a container's digest says about the spaces underneath it.
 *
 * Two things are under test, and both exist so that a number on a card is the
 * entity's number rather than the page size's: the per-entity tallies the
 * children card reads, and a caller's ability to ask for more rows per
 * section than it intends to show.
 */

import type { InAppNotificationDocument } from "@/types/in-app-notification";

const SUBTREE = [
  { slug: "example-goal", title: "Example Goal", type: "bhag" as const },
  {
    slug: "example-area",
    title: "Example Area",
    type: "area" as const,
    parent_slug: "example-goal",
  },
  {
    slug: "example-project",
    title: "Example Project",
    type: "project" as const,
    parent_slug: "example-area",
  },
];

let stored: InAppNotificationDocument[] = [];

jest.mock("@/lib/mongodb", () => ({
  getCollection: () =>
    Promise.resolve({
      find: () => ({
        sort: () => ({
          limit: () => ({ toArray: () => Promise.resolve(stored) }),
        }),
        toArray: () => Promise.resolve([]),
        project: () => ({ toArray: () => Promise.resolve([]) }),
      }),
    }),
}));

jest.mock("@/lib/in-app-notifications.server", () => ({
  notificationAudienceQuery: () => Promise.resolve({}),
}));

jest.mock("@/lib/notification-preferences.server", () => ({
  getNotificationPreferences: () => Promise.resolve({}),
  preferenceClauses: () => [],
}));

jest.mock("@/lib/tome/entity-hierarchy", () => ({
  resolveEntitySubtree: () => Promise.resolve(SUBTREE),
}));

jest.mock("@/lib/tome/watchers", () => ({
  listSubjectWatchedEntities: () => Promise.resolve([]),
}));

import { getEntitySummary } from "../entity-summary.server";

function row(
  overrides: Partial<InAppNotificationDocument> = {},
): InAppNotificationDocument {
  return {
    _id: "n1",
    title: "Something happened",
    message: "",
    category: "update",
    severity: "info",
    entity_slug: "example-project",
    created_at: "2026-10-10T12:00:00.000Z",
    read_by_subjects: [],
    dismissed_by_subjects: [],
    ...overrides,
  } as unknown as InAppNotificationDocument;
}

const summary = () =>
  getEntitySummary({
    entity: { slug: "example-goal", title: "Example Goal", type: "bhag" },
    principal: { subject: "user-1", email: "lead@example.com" },
  });

const entity = async (slug: string) =>
  (await summary()).scope_entities.find((entry) => entry.slug === slug);

beforeEach(() => {
  stored = [];
});

describe("per-entity tallies", () => {
  it("says which child something is waiting in, not just that something is", async () => {
    stored = [
      row({ _id: "a", entity_slug: "example-project", needs_attention: true }),
      row({ _id: "b", entity_slug: "example-project", needs_attention: true }),
      row({ _id: "c", entity_slug: "example-area", severity: "error" }),
    ];
    expect((await entity("example-project"))?.attention).toBe(2);
    expect((await entity("example-area"))?.attention).toBe(1);
    expect((await entity("example-goal"))?.attention).toBeUndefined();
  });

  it("counts an open decision as something waiting", async () => {
    stored = [row({ _id: "a", category: "decision" })];
    expect((await entity("example-project"))?.attention).toBe(1);
  });

  it("stops counting it once it is settled", async () => {
    stored = [
      row({
        _id: "a",
        category: "decision",
        lifecycle_status: "resolved",
        resolved_at: new Date().toISOString(),
      }),
    ];
    expect((await entity("example-project"))?.attention).toBe(0);
  });

  it("counts what this reader has not read, per child", async () => {
    stored = [
      row({ _id: "a", read_by_subjects: ["user-1"] }),
      row({ _id: "b" }),
      row({ _id: "c", entity_slug: "example-area" }),
    ];
    expect((await entity("example-project"))?.unread).toBe(1);
    expect((await entity("example-area"))?.unread).toBe(1);
  });

  it("dates each child by the newest thing it sent", async () => {
    stored = [
      row({ _id: "a", created_at: "2026-10-10T12:00:00.000Z" }),
      row({ _id: "b", created_at: "2026-10-01T12:00:00.000Z" }),
    ];
    expect((await entity("example-project"))?.latest_at).toBe(
      "2026-10-10T12:00:00.000Z",
    );
  });

  it("leaves a child that has sent nothing without a tally to show", async () => {
    stored = [row({ _id: "a", entity_slug: "example-area" })];
    const quiet = await entity("example-project");
    expect(quiet?.attention).toBeUndefined();
    expect(quiet?.latest_at).toBeUndefined();
  });

  it("keeps the hierarchy, so a project can be shown under its area", async () => {
    expect((await entity("example-project"))?.parent_slug).toBe("example-area");
  });
});

describe("rows per section", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      row({
        _id: `n${index}`,
        needs_attention: true,
        created_at: `2026-10-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
      }),
    );

  const attention = async (rows?: number) => {
    const result = await getEntitySummary({
      entity: { slug: "example-goal", title: "Example Goal", type: "bhag" },
      principal: { subject: "user-1", email: "lead@example.com" },
      ...(rows === undefined ? {} : { rows }),
    });
    return result.sections.find((section) => section.key === "attention");
  };

  it("gives a digest five, which is a section's worth", async () => {
    stored = many(9);
    const section = await attention();
    expect(section?.items).toHaveLength(5);
    expect(section?.total).toBe(9);
  });

  it("gives a caller that means to count them as many as it asked for", async () => {
    stored = many(9);
    expect((await attention(50))?.items).toHaveLength(9);
  });

  it("will not hand out more than the query itself fetches", async () => {
    stored = many(9);
    expect((await attention(10_000))?.items).toHaveLength(9);
    expect((await attention(0))?.items).toHaveLength(5);
    expect((await attention(-3))?.items).toHaveLength(5);
  });
});
