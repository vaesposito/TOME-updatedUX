/**
 * @jest-environment jsdom
 */

import { render, screen, within } from "@testing-library/react";
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

  it("aligns daily Tome activity to UTC while retaining trailing windows", async () => {
    const user = userEvent.setup();
    render(<TomeAnalyticsTab />);
    expect(await screen.findByText("Tome users today")).toBeInTheDocument();
    expect(screen.getByText("Tome visitors today")).toBeInTheDocument();
    expect(screen.getByText("Tome use over time")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: /Tome users, visitors, and chat users by day/i,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Tome chat users today"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tome chat users today").closest("div.rounded-lg"),
    ).toHaveTextContent("0");
    expect(
      screen.getByText("Tome chat users today").closest("div.rounded-lg"),
    ).toHaveTextContent("People who chatted with Tome today");
    expect(
      screen.getByText(
        /Today's numbers may still change.*Visitor data is available from Sep 13/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Chat MAU")).not.toBeInTheDocument();
    expect(
      screen.getByText("Areas used").closest("div.rounded-lg"),
    ).toHaveTextContent("1 of 1");
    await user.selectOptions(screen.getByLabelText("Time period"), "day");
    expect(
      screen.getByText("Areas used").closest("div.rounded-lg"),
    ).toHaveTextContent("0 of 1");
    expect(
      screen.getByText("BHAGs used").closest("div.rounded-lg"),
    ).toHaveTextContent("0 of 1");
    await user.click(screen.getByText("Reading activity"));
    expect(screen.getByText("Opened Tome chat")).toBeVisible();
    expect(screen.queryByText(/conversion/i)).not.toBeInTheDocument();
  });

  it("offers update history alongside failures and explains how pages changed", async () => {
    const user = userEvent.setup();
    render(<TomeAnalyticsTab />);
    await screen.findByText("Tome chat users today");
    await user.click(screen.getByRole("tab", { name: "Content" }));
    expect(screen.getByText("Update failures")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View update history" }),
    ).toHaveAttribute("href", "/projects/alpha/tome/ingest");
    await user.click(screen.getByText("Templates and page changes"));
    expect(screen.getByText("Edited by people: 2")).toBeVisible();
    expect(screen.queryByText(/revision sources/i)).not.toBeInTheDocument();
  });

  it("sorts analytics tables by metrics and dates", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          ...response,
          chat: {
            ...response.chat,
            entities: [
              {
                ...response.chat.entities[0],
                id: "project-alpha",
                name: "Alpha",
                slug: "alpha",
                lastPromptAt: "2026-09-01T11:00:00Z",
                activity: {
                  day: { users: 1, prompts: 10 },
                  week: { users: 1, prompts: 10 },
                  month: { users: 1, prompts: 10 },
                },
              },
              {
                ...response.chat.entities[0],
                id: "project-beta",
                name: "Beta",
                slug: "beta",
                lastPromptAt: "2026-09-15T11:00:00Z",
                activity: {
                  day: { users: 5, prompts: 2 },
                  week: { users: 5, prompts: 2 },
                  month: { users: 5, prompts: 2 },
                },
              },
              {
                ...response.chat.entities[0],
                id: "project-no-activity",
                name: "No activity",
                slug: "no-activity",
                lastPromptAt: null,
                activity: {
                  day: { users: 3, prompts: 6 },
                  week: { users: 3, prompts: 6 },
                  month: { users: 3, prompts: 6 },
                },
              },
            ],
          },
          projects: [
            {
              ...response.projects[0],
              projectId: "project-fewer-pages",
              slug: "fewer-pages",
              title: "Fewer pages",
              pageCount: 2,
              lastIngestedAt: "2026-09-01T00:00:00.000Z",
            },
            {
              ...response.projects[0],
              projectId: "project-more-pages",
              slug: "more-pages",
              title: "More pages",
              pageCount: 20,
              lastIngestedAt: "2026-09-15T00:00:00.000Z",
            },
            {
              ...response.projects[0],
              projectId: "project-never-updated",
              slug: "never-updated",
              title: "Never updated",
              pageCount: 10,
              lastIngestedAt: null,
            },
          ],
          budget: {
            ...response.budget,
            byEntity: [
              {
                projectId: "project-alpha",
                name: "Alpha",
                slug: "alpha",
                type: "project",
                ingestionUsd: 10,
                synthesisUsd: 50,
                measuredRuns: 1,
                runs: 4,
              },
              {
                projectId: "project-beta",
                name: "Beta",
                slug: "beta",
                type: "project",
                ingestionUsd: 40,
                synthesisUsd: 5,
                measuredRuns: 4,
                runs: 4,
              },
            ],
          },
        },
      }),
    });
    const user = userEvent.setup();
    render(<TomeAnalyticsTab />);
    await screen.findByText("Tome chat users today");

    const usageTable = screen.getByRole("table", {
      name: "Chat activity by project, Area, and BHAG",
    });
    expect(within(usageTable).getAllByRole("row")[1]).toHaveTextContent("Beta");
    await user.click(
      within(usageTable).getByRole("button", {
        name: "Sort by People ascending",
      }),
    );
    expect(within(usageTable).getAllByRole("row")[1]).toHaveTextContent(
      "Alpha",
    );
    await user.click(
      within(usageTable).getByRole("button", {
        name: "Sort by Messages descending",
      }),
    );
    expect(within(usageTable).getAllByRole("row")[1]).toHaveTextContent(
      "Alpha",
    );
    await user.click(
      within(usageTable).getByRole("button", {
        name: "Sort by Messages ascending",
      }),
    );
    expect(within(usageTable).getAllByRole("row")[1]).toHaveTextContent("Beta");
    await user.click(
      within(usageTable).getByRole("button", {
        name: "Sort by Last activity descending",
      }),
    );
    expect(within(usageTable).getAllByRole("row")[1]).toHaveTextContent("Beta");
    expect(within(usageTable).getAllByRole("row").at(-1)).toHaveTextContent(
      "No activity",
    );
    expect(
      within(usageTable).getByText("Last activity").closest("th"),
    ).toHaveAttribute("aria-sort", "descending");
    await user.click(
      within(usageTable).getByRole("button", {
        name: "Sort by Last activity ascending",
      }),
    );
    expect(within(usageTable).getAllByRole("row")[1]).toHaveTextContent("Alpha");
    expect(within(usageTable).getAllByRole("row").at(-1)).toHaveTextContent(
      "No activity",
    );

    await user.click(screen.getByRole("tab", { name: "Content" }));
    const ingestionTable = screen.getByRole("table", {
      name: "Content by project, Area, and BHAG",
    });
    await user.click(
      within(ingestionTable).getByRole("button", {
        name: "Sort by Pages descending",
      }),
    );
    expect(within(ingestionTable).getAllByRole("row")[1]).toHaveTextContent(
      "More pages",
    );
    await user.click(
      within(ingestionTable).getByRole("button", {
        name: "Sort by Pages ascending",
      }),
    );
    expect(within(ingestionTable).getAllByRole("row")[1]).toHaveTextContent(
      "Fewer pages",
    );
    await user.click(
      within(ingestionTable).getByRole("button", {
        name: "Sort by Last updated descending",
      }),
    );
    expect(within(ingestionTable).getAllByRole("row")[1]).toHaveTextContent(
      "More pages",
    );
    expect(within(ingestionTable).getAllByRole("row").at(-1)).toHaveTextContent(
      "Never updated",
    );
    expect(
      within(ingestionTable).getByText("Last updated").closest("th"),
    ).toHaveAttribute("aria-sort", "descending");
    await user.click(
      within(ingestionTable).getByRole("button", {
        name: "Sort by Last updated ascending",
      }),
    );
    expect(within(ingestionTable).getAllByRole("row")[1]).toHaveTextContent(
      "Fewer pages",
    );
    expect(within(ingestionTable).getAllByRole("row").at(-1)).toHaveTextContent(
      "Never updated",
    );

    await user.click(screen.getByRole("tab", { name: "Budget" }));
    const spendTable = screen.getByRole("table", {
      name: "Spending by project, Area, and BHAG",
    });
    await user.click(
      within(spendTable).getByRole("button", {
        name: "Sort by Source updates descending",
      }),
    );
    expect(within(spendTable).getAllByRole("row")[1]).toHaveTextContent("Beta");
    await user.click(
      within(spendTable).getByRole("button", {
        name: "Sort by Area and BHAG summaries descending",
      }),
    );
    expect(within(spendTable).getAllByRole("row")[1]).toHaveTextContent(
      "Alpha",
    );
    await user.click(
      within(spendTable).getByRole("button", {
        name: "Sort by Updates with costs descending",
      }),
    );
    expect(within(spendTable).getAllByRole("row")[1]).toHaveTextContent("Beta");
    await user.click(
      within(spendTable).getByRole("button", {
        name: "Sort by Updates with costs ascending",
      }),
    );
    expect(within(spendTable).getAllByRole("row")[1]).toHaveTextContent(
      "Alpha",
    );
  });

  it("saves a budget and explains incomplete cost reporting", async () => {
    const user = userEvent.setup();
    render(<TomeAnalyticsTab />);
    await screen.findByText("Tome chat users today");
    await user.click(screen.getByRole("tab", { name: "Budget" }));
    expect(
      screen.getByText(/1 update does not include cost yet/),
    ).toBeVisible();
    expect(screen.getByText(/does not pause updates/)).toBeVisible();
    await user.type(screen.getByLabelText("Monthly limit (USD)"), "100");
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
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Budget updated.")).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/tome/admin/analytics/budget",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ monthlyLimitUsd: 100, alertAtPercent: 80 }),
      }),
    );
    expect(
      screen.getByText(/Spending is close to this month's budget/),
    ).toBeVisible();
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
    expect(screen.queryByText("Tome chat users today")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Budget" }));
    expect(screen.getByText("Spent so far")).toBeVisible();
  });
});
