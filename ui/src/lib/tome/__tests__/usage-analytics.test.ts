jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeChatMessagesCollection: jest.fn(),
  getTomeUsageEventsCollection: jest.fn(),
}));

import { getCollection } from "@/lib/mongodb";
import {
  getTomeUsageEventsCollection,
  getTomeChatMessagesCollection,
} from "@/lib/tome/mongo-collections";
import {
  getTomeUsageAnalytics,
  summarizeTomeUsageAnalytics,
} from "@/lib/tome/usage-analytics";

describe("Tome usage analytics", () => {
  it("separates reach, page, chat, template, edit, ingest, and draft metrics", () => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    const result = summarizeTomeUsageAnalytics(
      {
        trackingStartedAt: new Date("2026-09-12T08:00:00.000Z"),
        subjects: [
          {
            subjectHash: "user-1",
            lastAt: new Date("2026-09-13T11:00:00.000Z"),
            days: ["2026-09-12", "2026-09-13"],
            sessions: ["session-1"],
            views: 5,
            chatViewed: true,
          },
          {
            subjectHash: "user-2",
            lastAt: new Date("2026-09-03T11:00:00.000Z"),
            days: ["2026-09-03"],
            sessions: ["session-2"],
            views: 2,
            chatViewed: false,
          },
        ],
        pageViews: [
          {
            projectId: "project-1",
            projectSlug: "primary",
            pagePath: "architecture.md",
            views: 5,
            viewerIds: ["user-1", "user-2"],
            lastViewedAt: new Date("2026-09-13T11:00:00.000Z"),
          },
          {
            projectId: "project-1",
            projectSlug: "primary",
            pagePath: "notes/manual.md",
            views: 2,
            viewerIds: ["user-1"],
            lastViewedAt: new Date("2026-09-12T11:00:00.000Z"),
          },
        ],
        dailyViews: [
          {
            date: "2026-09-13",
            subjectHashes: ["user-1"],
            pageViews: 3,
            chatViewers: 1,
          },
        ],
        chatDays: [
          { date: "2026-09-13", subjectHash: "user-1", prompts: 2 },
          { date: "2026-09-11", subjectHash: "chat-user-2", prompts: 1 },
        ],
        currentPages: [
          {
            projectId: "project-1",
            path: "architecture.md",
            markdown: "---\ntemplate_scope: top-level\n---\n# Architecture",
          },
          {
            projectId: "project-1",
            path: "notes/manual.md",
            markdown: "---\ntemplate_scope: null\n---\n# Notes",
          },
        ],
        manualEdits: [
          {
            editor: "editor-1@example.test",
            projectId: "project-1",
            path: "architecture.md",
            revisions: 2,
          },
          {
            editor: "editor-2@example.test",
            projectId: "project-1",
            path: "notes/manual.md",
            revisions: 1,
          },
        ],
        runs: [
          {
            status: "succeeded",
            startedAt: new Date("2026-09-10T00:00:00.000Z"),
            finishedAt: new Date("2026-09-10T01:00:00.000Z"),
            reviewedAt: new Date("2026-09-10T01:00:00.000Z"),
            reviewOutcome: "approved",
            endpoint: "/ingest",
          },
          {
            status: "failed",
            startedAt: new Date("2026-09-11T00:00:00.000Z"),
            finishedAt: new Date("2026-09-11T01:00:00.000Z"),
            reviewedAt: new Date("2026-09-11T01:00:00.000Z"),
            reviewOutcome: "rejected",
            endpoint: "/ingest",
          },
          {
            status: "awaiting_review",
            startedAt: new Date("2026-09-12T00:00:00.000Z"),
            endpoint: "/ingest",
          },
          {
            status: "succeeded",
            startedAt: new Date("2026-09-12T00:00:00.000Z"),
            endpoint: "/synthesize",
          },
        ],
      },
      now,
      30,
    );

    expect(result.reach).toEqual({
      dailyUsers: 1,
      weeklyUsers: 1,
      monthlyUsers: 2,
      returningUsers: 1,
      sessions: 2,
      views: 7,
    });
    expect(result.pages).toMatchObject({ views: 7, uniqueViewers: 2 });
    expect(result.pages.top[0]).toMatchObject({
      pagePath: "architecture.md",
      views: 5,
      uniqueViewers: 2,
    });
    expect(result.tracking).toEqual({
      startedAt: new Date("2026-09-12T08:00:00.000Z"),
      coverageDays: 2,
      fullWindow: false,
    });
    expect(result.chat).toEqual({ viewers: 1, engagedUsers: 2, prompts: 3 });
    expect(result.templates).toMatchObject({
      boundPages: 1,
      unboundPages: 1,
      projectsUsingTemplates: 1,
      views: 5,
    });
    expect(
      result.templates.byScope.find((row) => row.scope === "top-level"),
    ).toEqual({ scope: "top-level", pages: 1, projects: 1, views: 5 });
    expect(result.manualEdits).toEqual({
      revisions: 3,
      editors: 2,
      pages: 2,
      projects: 1,
    });
    expect(result.ingestion).toEqual({
      runs: 3,
      succeeded: 1,
      failed: 0,
      rejected: 1,
      pending: 1,
      successRate: 1,
    });
    expect(result.drafts).toEqual({
      sentToReview: 3,
      pending: 1,
      approved: 1,
      rejected: 1,
      autoPromoted: 0,
      approvalRate: 0.5,
    });
    expect(result.daily.find((row) => row.date === "2026-09-13")).toEqual({
      date: "2026-09-13",
      activeUsers: 1,
      tomeUsers: 1,
      pageViews: 3,
      chatViewers: 1,
      chatUsers: 1,
      prompts: 2,
    });
    expect(
      result.daily.find((row) => row.date === "2026-09-11")?.activeUsers,
    ).toBeNull();
  });
});

it("preserves the legacy template fallback when Mongo $first returns null for a missing field", async () => {
  const empty = { toArray: async () => [] };
  const pageAggregate = jest
    .fn()
    .mockReturnValueOnce({
      toArray: async () => [
        {
          _id: { projectId: "p", path: "legacy.md" },
          templateScope: null,
          hasTemplateScope: false,
          markdown: "---\ntemplate_scope: top-level\n---\n# Legacy",
        },
        {
          _id: { projectId: "p", path: "unbound.md" },
          templateScope: null,
          hasTemplateScope: true,
          markdown: "---\ntemplate_scope: top-level\n---\n# Unbound",
        },
      ],
    })
    .mockReturnValueOnce(empty)
    .mockReturnValueOnce(empty);
  jest.mocked(getCollection).mockImplementation(async (name) => {
    if (name === "projects")
      return {
        find: () => ({
          project: () => ({
            toArray: async () => [{ _id: "p", slug: "primary" }],
          }),
        }),
      } as never;
    if (name === "tome_page_revisions")
      return { aggregate: pageAggregate } as never;
    return { find: () => empty } as never;
  });
  jest
    .mocked(getTomeUsageEventsCollection)
    .mockResolvedValue({
      aggregate: () => empty,
      find: () => ({
        sort: () => ({ limit: () => ({ next: async () => null }) }),
      }),
    } as never);
  jest
    .mocked(getTomeChatMessagesCollection)
    .mockResolvedValue({ aggregate: () => empty } as never);
  const result = await getTomeUsageAnalytics();
  expect(result.templates).toMatchObject({
    boundPages: 1,
    unboundPages: 1,
    projectsUsingTemplates: 1,
  });
  const group = pageAggregate.mock.calls[0][0].find(
    (stage: Record<string, unknown>) => stage.$group,
  ).$group;
  expect(group.hasTemplateScope).toEqual({
    $first: { $ne: [{ $type: "$template_scope" }, "missing"] },
  });
});

it("attributes recoverable manual history without relabeling all legacy revisions", () => {
  const result = summarizeTomeUsageAnalytics(
    {
      trackingStartedAt: null,
      subjects: [],
      pageViews: [],
      dailyViews: [],
      chatDays: [],
      currentPages: [],
      runs: [],
      manualEdits: [
        {
          editor: "editor@example.test",
          projectId: "p",
          path: "overview.md",
          revisions: 5,
        },
      ],
      revisionSources: [
        { origin: "manual", revisions: 2 },
        { origin: "legacy", revisions: 8 },
        { origin: "ingest", revisions: 10 },
      ],
    },
    new Date("2026-09-15T00:00:00Z"),
  );
  expect(result.revisionSources).toEqual(
    expect.arrayContaining([
      { origin: "manual", revisions: 5 },
      { origin: "legacy", revisions: 5 },
      { origin: "ingest", revisions: 10 },
    ]),
  );
});
