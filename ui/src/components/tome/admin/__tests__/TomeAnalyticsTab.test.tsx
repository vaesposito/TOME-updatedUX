/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TomeAnalyticsTab } from "../TomeAnalyticsTab";

const fetchMock = jest.fn();
global.fetch = fetchMock;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock;

const response = {
  errors: {},
  chat: {
    asOf: "2026-09-15T12:00:00Z",
    periods: {
      day: {
        users: 2,
        prompts: 5,
        activeEntities: { project: 1, area: 0, bhag: 0 },
      },
      week: {
        users: 3,
        prompts: 12,
        activeEntities: { project: 1, area: 1, bhag: 0 },
      },
      month: {
        users: 4,
        prompts: 20,
        activeEntities: { project: 1, area: 1, bhag: 1 },
      },
    },
    totals: { project: 2, area: 1, bhag: 1 },
    entities: [
      {
        id: "project-1",
        slug: "alpha",
        name: "Alpha",
        type: "project",
        lastPromptAt: "2026-09-15T11:00:00Z",
        activity: {
          day: { users: 2, prompts: 5 },
          week: { users: 3, prompts: 12 },
          month: { users: 4, prompts: 20 },
        },
      },
    ],
    daily: [],
  },
  budget: {
    monthlyLimitUsd: null,
    alertAtPercent: 80,
    month: "2026-09",
    periodStart: "2026-09-01T00:00:00Z",
    periodEnd: "2026-10-01T00:00:00Z",
    asOf: "2026-09-15T12:00:00Z",
    spentUsd: 85,
    remainingUsd: null,
    utilizationPercent: null,
    status: "not_configured",
    runs: 4,
    measuredRuns: 3,
    unmeasuredRuns: 1,
    pendingRuns: 1,
    inputTokens: 100,
    outputTokens: 20,
    byEntity: [],
  },
  projects: [
    {
      projectId: "project-1",
      slug: "alpha",
      title: "Alpha",
      pageCount: 12,
      wikiSizeBytes: 1024,
      lastIngestedAt: "2026-09-01T00:00:00.000Z",
      activeIngest: null,
      ingestRunsSucceeded: 3,
      tokenUsage: { input: 100, output: 20 },
    },
  ],
  totals: {
    projectCount: 1,
    activeIngestCount: 0,
    totalPages: 12,
    totalWikiSizeBytes: 1024,
    totalTokens: 120,
  },
  freshness: {
    positive: 0,
    negative: 0,
    total: 0,
    satisfactionRate: null,
    windowDays: 30,
  },
  performance: {
    p95Seconds: null,
    configured: true,
    status: "no_data",
    targetSeconds: 10,
  },
  uptime: {
    uptimePct: null,
    processUptimeSeconds: null,
    coveragePct: 20,
    configured: true,
    status: "collecting",
    windowHours: 24,
    targetPct: 99.9,
  },
  leadership: {
    windowDays: 30,
    coverage: { eligibleProjects: 1, stewardedProjects: 1, sourcedProjects: 1 },
    activity: { activeProjects: 1, dormantProjects: 0 },
    engagement: { sessions: 2, messages: 5, repeatUsers: 1 },
    sourceHealth: { fresh: 0, aging: 1, stale: 0, never: 0 },
    bhag: {
      count: 0,
      childProjects: 0,
      fresh: 0,
      aging: 0,
      stale: 0,
      never: 0,
    },
    hierarchy: {
      bhags: 0,
      areas: 0,
      projects: 1,
      bhagAreaRelations: 0,
      bhagProjectRelations: 0,
      areaProjectRelations: 0,
    },
    onboarding: { totalProjects: 1, addedInWindow: 0 },
    wikiMaturity: { realWikis: 1, greenfieldOnly: 0, emptyShells: 0 },
    ingestReliability: { succeeded: 2, failed: 1, successRate: 2 / 3 },
    cost: {
      totalUsd: 1,
      perActiveProjectUsd: 1,
      measuredRuns: 2,
      terminalRuns: 3,
    },
    projectEngagement: [
      {
        projectId: "project-1",
        slug: "alpha",
        name: "Alpha",
        sessions: 2,
        messages: 5,
        repeatUsers: 1,
      },
    ],
    bhagBreakdown: [],
  },
  usage: {
    windowDays: 30,
    tracking: {
      startedAt: "2026-09-13T00:00:00.000Z",
      coverageDays: 1,
      fullWindow: false,
    },
    reach: {
      dailyUsers: 1,
      weeklyUsers: 1,
      monthlyUsers: 1,
      returningUsers: 0,
      sessions: 1,
      views: 2,
    },
    pages: { views: 1, uniqueViewers: 1, top: [] },
    chat: { viewers: 1, engagedUsers: 2, prompts: 5 },
    templates: {
      boundPages: 0,
      unboundPages: 12,
      projectsUsingTemplates: 0,
      views: 0,
      byScope: [],
    },
    revisionSources: [{ origin: "manual", revisions: 2 }],
    manualEdits: { revisions: 2, editors: 1, pages: 1, projects: 1 },
    ingestion: {
      runs: 3,
      succeeded: 2,
      failed: 1,
      pending: 0,
      successRate: 2 / 3,
    },
    drafts: {
      sentToReview: 1,
      pending: 0,
      approved: 1,
      rejected: 0,
      autoPromoted: 0,
      approvalRate: 1,
    },
    daily: [
      {
        date: "2026-09-13",
        activeUsers: 1,
        tomeUsers: 1,
        pageViews: 1,
        chatViewers: 1,
        chatUsers: 0,
        prompts: 0,
      },
    ],
  },
  trends: {
    adoption: [],
    freshness: [],
    ingestActivity: [],
    performance: { points: [], configured: true },
    uptime: { points: [], configured: true },
    onboarding: [],
  },
};

describe("TomeAnalyticsTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: response }),
    });
  });

  it("shows deduplicated Tome activity and prompt-based DAU/MAU", async () => {
    const user = userEvent.setup();
    render(<TomeAnalyticsTab />);
    expect(await screen.findByText("Tome DAU")).toBeInTheDocument();
    expect(screen.getByText("Tome visitors today")).toBeInTheDocument();
    expect(screen.getByText("Daily Tome users")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: /Daily Tome active users, visitors, and chat users/i,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Chat DAU")).toBeInTheDocument();
    expect(screen.getByText("Chat MAU")).toBeInTheDocument();
    expect(
      screen.getByText("Active Areas").closest("div.rounded-lg"),
    ).toHaveTextContent("1 / 1");
    await user.selectOptions(screen.getByLabelText("Activity window"), "day");
    expect(
      screen.getByText("Active Areas").closest("div.rounded-lg"),
    ).toHaveTextContent("0 / 1");
    expect(
      screen.getByText("Active BHAGs").closest("div.rounded-lg"),
    ).toHaveTextContent("0 / 1");
    await user.click(screen.getByText("Reading and discovery"));
    expect(screen.getByText("Opened Agent")).toBeVisible();
    expect(screen.queryByText(/conversion/i)).not.toBeInTheDocument();
  });

  it("offers a direct ingestion-history action alongside failures and preserves revision sources", async () => {
    const user = userEvent.setup();
    render(<TomeAnalyticsTab />);
    await screen.findByText("Chat DAU");
    await user.click(screen.getByRole("tab", { name: "Content" }));
    expect(screen.getByText("Ingestion failures")).toBeVisible();
    expect(screen.getByRole("link", { name: "View runs" })).toHaveAttribute(
      "href",
      "/projects/alpha/tome/ingest",
    );
    await user.click(screen.getByText("Templates and revision sources"));
    expect(screen.getByText("Manual edits: 2")).toBeVisible();
  });

  it("saves an admin budget and shows updated usage with incomplete cost coverage", async () => {
    const user = userEvent.setup();
    render(<TomeAnalyticsTab />);
    await screen.findByText("Chat DAU");
    await user.click(screen.getByRole("tab", { name: "Budget" }));
    expect(screen.getByText(/1 runs have unknown cost/)).toBeVisible();
    expect(screen.getByText(/does not stop ingestion/)).toBeVisible();
    await user.type(screen.getByLabelText("Monthly budget (USD)"), "100");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          ...response.budget,
          monthlyLimitUsd: 100,
          remainingUsd: 15,
          utilizationPercent: 85,
          status: "near_limit",
        },
      }),
    });
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(await screen.findByText("Budget saved.")).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/tome/admin/analytics/budget",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ monthlyLimitUsd: 100, alertAtPercent: 80 }),
      }),
    );
    expect(screen.getByText(/Approaching monthly budget/)).toBeVisible();
    expect(screen.getByText("$15.00")).toBeVisible();
  });

  it("keeps budget accessible when chat analytics fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          ...response,
          chat: null,
          errors: { chat: "Chat analytics unavailable." },
        },
      }),
    });
    const user = userEvent.setup();
    render(<TomeAnalyticsTab />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Chat analytics unavailable.",
    );
    expect(screen.queryByText("Chat DAU")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Budget" }));
    expect(screen.getByText("Recorded spend")).toBeVisible();
  });
});
