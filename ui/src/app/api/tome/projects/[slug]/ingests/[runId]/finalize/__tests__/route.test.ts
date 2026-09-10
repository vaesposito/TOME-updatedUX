/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockFindRun = jest.fn();
const mockListDraftPaths = jest.fn();
const mockFinalize = jest.fn();
const mockGetEvaluation = jest.fn();
const mockQualityGateDecision = jest.fn();
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
  getPageStore: async () => ({ listDraftPaths: mockListDraftPaths }),
}));

jest.mock("@/lib/tome/ingest-runner", () => ({
  finalizeDraftFileReview: (...args: unknown[]) => mockFinalize(...args),
}));

jest.mock("@/lib/tome/evaluation-store", () => ({
  fallbackQualityPolicy: () => ({
    version: 0,
    mode: "off",
    allow_steward_override: true,
    require_human_review: true,
  }),
  getArtifactEvaluation: (...args: unknown[]) => mockGetEvaluation(...args),
  insertQualityGateOverride: jest.fn(),
}));

jest.mock("@/lib/tome/rubric-evaluator", () => ({
  qualityGateDecision: (...args: unknown[]) => mockQualityGateDecision(...args),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: () => ({ type: "user", id: "reviewer@example.test" }),
}));

const context = {
  params: Promise.resolve({ slug: "example-project", runId: "run-example" }),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-example",
    user: { email: "reviewer@example.test" },
    session: {},
  });
  mockFindRun.mockResolvedValue({
    _id: "run-example",
    project_id: "project-example",
    report_id: "report-example",
    status: "awaiting_review",
    file_reviews: [
      {
        path: "accepted.md",
        decision: "accept",
        reviewed_by: "reviewer@example.test",
        reviewed_at: new Date(),
      },
      {
        path: "rejected.md",
        decision: "reject",
        reviewed_by: "reviewer@example.test",
        reviewed_at: new Date(),
      },
    ],
  });
  mockListDraftPaths.mockResolvedValue(["accepted.md", "rejected.md"]);
  mockQualityGateDecision.mockReturnValue({ allowed: true });
  mockFinalize.mockResolvedValue({ accepted: 1, rejected: 1 });
});

describe("POST finalize file-level ingest review", () => {
  it("finalizes once every draft file has a decision", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/ingests/run-example/finalize",
        { method: "POST", body: "{}" },
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockFinalize).toHaveBeenCalledWith("run-example", "reviewer@example.test");
    expect(mockAuditTome).toHaveBeenCalledWith(expect.objectContaining({
      action: "tome.ingest.finalize_review",
      metadata: expect.objectContaining({ accepted: 1, rejected: 1 }),
    }));
  });

  it("refuses to finish while a file is still pending", async () => {
    mockFindRun.mockResolvedValue({
      _id: "run-example",
      project_id: "project-example",
      report_id: "report-example",
      status: "awaiting_review",
      file_reviews: [],
    });

    const { POST } = await import("../route");
    await expect(POST(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/ingests/run-example/finalize",
        { method: "POST", body: "{}" },
      ),
      context,
    )).rejects.toThrow("Review every file before finishing (2 remaining)");
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it("does not apply a publication quality gate when every file is rejected", async () => {
    mockFindRun.mockResolvedValue({
      _id: "run-example",
      project_id: "project-example",
      report_id: "report-example",
      status: "awaiting_review",
      file_reviews: [{
        path: "rejected.md",
        decision: "reject",
        reviewed_by: "reviewer@example.test",
        reviewed_at: new Date(),
      }],
    });
    mockListDraftPaths.mockResolvedValue(["rejected.md"]);
    mockFinalize.mockResolvedValue({ accepted: 0, rejected: 1 });

    const { POST } = await import("../route");
    await POST(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/ingests/run-example/finalize",
        { method: "POST", body: "{}" },
      ),
      context,
    );

    expect(mockQualityGateDecision).not.toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalled();
  });
});
