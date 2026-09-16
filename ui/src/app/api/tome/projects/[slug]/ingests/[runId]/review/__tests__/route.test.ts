/** @jest-environment node */

import { NextRequest } from "next/server";

import type { PageRevision } from "@/types/tome";

const mockLoadTomeProject = jest.fn();
const mockFindRun = jest.fn();
const mockListTouchedPaths = jest.fn();
const mockListDraftPaths = jest.fn();
const mockPageHistory = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockReviewDraftFile = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {},
  successResponse: (data: unknown) => Response.json(data),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
}));

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({ findOne: mockFindRun }),
}));

jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: async () => ({
    listTouchedPaths: (...args: unknown[]) => mockListTouchedPaths(...args),
    listDraftPaths: (...args: unknown[]) => mockListDraftPaths(...args),
    pageHistory: (...args: unknown[]) => mockPageHistory(...args),
  }),
}));

jest.mock("@/lib/tome/ingest-runner", () => ({
  reviewDraftFile: (...args: unknown[]) => mockReviewDraftFile(...args),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: () => ({ type: "user", id: "reviewer@example.test" }),
}));

import { GET } from "../route";

const CURRENT_REPORT = "report-current";
const PATH = "architecture.md";
const context = {
  params: Promise.resolve({ slug: "example-area", runId: "run-current" }),
};

function revision(
  markdown: string,
  options: Partial<PageRevision> = {},
): PageRevision {
  return {
    project_id: "project-example",
    path: PATH,
    markdown,
    author: "example-agent",
    message: "example write",
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...options,
  };
}

async function review(history: PageRevision[]) {
  mockPageHistory.mockResolvedValue(history);
  const response = await GET(
    new NextRequest(
      "http://localhost/api/tome/projects/example-area/ingests/run-current/review",
    ),
    context,
  );
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-example",
    project: { _id: "project-example", slug: "example-area", review_mode: "stable_only" },
    user: { email: "reviewer@example.test" },
    session: {},
  });
  mockFindRun.mockResolvedValue({
    _id: "run-current",
    project_id: "project-example",
    report_id: CURRENT_REPORT,
    status: "awaiting_review",
  });
  mockListTouchedPaths.mockResolvedValue([PATH]);
  mockListDraftPaths.mockResolvedValue([PATH]);
});

describe("GET ingest review baseline", () => {
  it.each([
    ["rejected", "rejected"],
    ["pending", "draft"],
  ] as const)(
    "treats a page with only a prior %s draft as new",
    async (_label, status) => {
      const body = await review([
        revision("# Current draft", { report_id: CURRENT_REPORT, status: "draft" }),
        revision("# Earlier draft", { report_id: "report-earlier", status }),
      ]);

      expect(body.pages).toEqual([
        {
          path: PATH,
          oldBody: "",
          newBody: "# Current draft",
          isNewPage: true,
          requiresDecision: true,
          decision: null,
          reviewedBy: null,
          reviewedAt: null,
        },
      ]);
    },
  );

  it("compares the final write with the live page before the report's first write", async () => {
    const body = await review([
      revision("# Final draft", { report_id: CURRENT_REPORT, status: "draft" }),
      revision("# Intermediate draft", { report_id: CURRENT_REPORT, status: "draft" }),
      revision("# Live before ingest", { report_id: "report-live", status: "live" }),
    ]);

    expect(body.pages[0]).toEqual({
      path: PATH,
      oldBody: "# Live before ingest",
      newBody: "# Final draft",
      isNewPage: false,
      requiresDecision: true,
      decision: null,
      reviewedBy: null,
      reviewedAt: null,
    });
  });

  it("uses a prior legacy live revision with no status", async () => {
    const body = await review([
      revision("# Current draft", { report_id: CURRENT_REPORT, status: "draft" }),
      revision("# Rejected draft", { report_id: "report-rejected", status: "rejected" }),
      revision("# Legacy live page", { report_id: "report-live" }),
    ]);

    expect(body.pages[0]).toEqual({
      path: PATH,
      oldBody: "# Legacy live page",
      newBody: "# Current draft",
      isNewPage: false,
      requiresDecision: true,
      decision: null,
      reviewedBy: null,
      reviewedAt: null,
    });
  });

  it("treats a page whose latest prior live revision is a tombstone as new", async () => {
    const body = await review([
      revision("# Recreated draft", { report_id: CURRENT_REPORT, status: "draft" }),
      revision("", { deleted: true, status: "live" }),
      revision("# Live before deletion", { status: "live" }),
    ]);

    expect(body.pages[0]).toEqual({
      path: PATH,
      oldBody: "",
      newBody: "# Recreated draft",
      isNewPage: true,
      requiresDecision: true,
      decision: null,
      reviewedBy: null,
      reviewedAt: null,
    });
  });

  it("returns a persisted decision with the diff", async () => {
    mockFindRun.mockResolvedValue({
      _id: "run-current",
      project_id: "project-example",
      report_id: CURRENT_REPORT,
      status: "awaiting_review",
      file_reviews: [{
        path: PATH,
        decision: "accept",
        reviewed_by: "reviewer@example.test",
        reviewed_at: new Date("2026-01-02T00:00:00Z"),
      }],
    });
    const body = await review([
      revision("# Current draft", { report_id: CURRENT_REPORT, status: "draft" }),
    ]);

    expect(body.pages[0]).toEqual(expect.objectContaining({
      decision: "accept",
      reviewedBy: "reviewer@example.test",
    }));
  });

  it("shows every file touched by a pending ingest, including files already published by policy", async () => {
    const publishedPath = "updates/example.md";
    mockListTouchedPaths.mockResolvedValue([publishedPath, PATH]);
    mockListDraftPaths.mockResolvedValue([PATH]);
    mockPageHistory.mockImplementation(async (_projectId: string, path: string) => (
      path === publishedPath
        ? [
            revision("# Published update", {
              path: publishedPath,
              report_id: CURRENT_REPORT,
              status: "live",
            }),
            revision("# Previous update", { path: publishedPath, status: "live" }),
          ]
        : [revision("# Current draft", { report_id: CURRENT_REPORT, status: "draft" })]
    ));

    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-area/ingests/run-current/review",
      ),
      context,
    );
    const body = await response.json();

    expect(body.status).toBe("awaiting_review");
    expect(body.reviewMode).toBe("stable_only");
    expect(body.pages).toEqual([
      expect.objectContaining({ path: PATH, requiresDecision: true }),
      expect.objectContaining({
        path: publishedPath,
        requiresDecision: false,
        oldBody: "# Previous update",
        newBody: "# Published update",
      }),
    ]);
  });
});

describe("PATCH ingest file review", () => {
  it("persists and audits one file decision", async () => {
    const { PATCH } = await import("../route");
    const response = await PATCH(
      new NextRequest(
        "http://localhost/api/tome/projects/example-area/ingests/run-current/review",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: PATH, decision: "reject" }),
        },
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockRequireTomeEditor).toHaveBeenCalled();
    expect(mockReviewDraftFile).toHaveBeenCalledWith(
      "run-current",
      PATH,
      "reject",
      "reviewer@example.test",
    );
    expect(mockAuditTome).toHaveBeenCalledWith(expect.objectContaining({
      action: "tome.ingest.file_review",
      page: PATH,
    }));
  });
});
