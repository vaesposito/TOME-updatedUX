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
const mockInsertOverride = jest.fn();

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
  insertQualityGateOverride: (...args: unknown[]) => mockInsertOverride(...args),
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
  const bulkRequest = (decision: unknown, override_reason?: string) => new NextRequest(
    "http://localhost/api/tome/projects/example-project/ingests/run-example/finalize",
    { method: "POST", body: JSON.stringify({ decision, override_reason }) },
  );

  it.each(["accept", "reject"])("allows bulk %s with unreviewed files and mixed saved choices", async (decision) => {
    mockListDraftPaths.mockResolvedValue(["accepted.md", "rejected.md", "pending.md"]);
    const { POST } = await import("../route");
    const response = await POST(bulkRequest(decision), context);
    expect(response.status).toBe(200);
    expect(mockFinalize).toHaveBeenCalledWith("run-example", "reviewer@example.test", decision);
    expect(mockRequireTomeEditor).toHaveBeenCalled();
    if (decision === "reject") expect(mockQualityGateDecision).not.toHaveBeenCalled();
    else expect(mockQualityGateDecision).toHaveBeenCalled();
  });

  it("enforces the publication quality gate for bulk accept", async () => {
    mockQualityGateDecision.mockReturnValue({ allowed: false, requires_override: false });
    const { POST } = await import("../route");
    await expect(POST(bulkRequest("accept"), context)).rejects.toThrow("Quality gate failed");
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it("requires and records a permitted quality override before bulk accept", async () => {
    mockQualityGateDecision.mockReturnValue({ allowed: false, requires_override: true });
    const { POST } = await import("../route");
    await expect(POST(bulkRequest("accept", "short"), context)).rejects.toThrow("at least 10 characters");
    expect(mockFinalize).not.toHaveBeenCalled();
    expect(mockInsertOverride).not.toHaveBeenCalled();
    await POST(bulkRequest("accept", "Reviewed and verified the source evidence"), context);
    expect(mockInsertOverride).toHaveBeenCalledWith(expect.objectContaining({
      actor: "reviewer@example.test",
      reason: "Reviewed and verified the source evidence",
    }));
    expect(mockFinalize).toHaveBeenCalledWith("run-example", "reviewer@example.test", "accept");
  });

  it("lets bulk rejection finish even when publication is blocked", async () => {
    mockQualityGateDecision.mockReturnValue({ allowed: false, requires_override: false });
    const { POST } = await import("../route");
    await POST(bulkRequest("reject"), context);
    expect(mockQualityGateDecision).not.toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalledWith("run-example", "reviewer@example.test", "reject");
  });

  it.each(["approve", "", null, 1, {}])("rejects invalid bulk decision %p", async (decision) => {
    const { POST } = await import("../route");
    await expect(POST(bulkRequest(decision), context)).rejects.toThrow("Decision must be accept or reject");
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it("does not resolve a completed run again", async () => {
    mockFindRun.mockResolvedValue({ status: "succeeded" });
    const { POST } = await import("../route");
    await expect(POST(bulkRequest("reject"), context)).rejects.toThrow("Run is not awaiting review");
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it("refuses bulk review without editor permission", async () => {
    mockRequireTomeEditor.mockImplementationOnce(() => { throw new Error("Forbidden"); });
    const { POST } = await import("../route");
    await expect(POST(bulkRequest("accept"), context)).rejects.toThrow("Forbidden");
    expect(mockFinalize).not.toHaveBeenCalled();
  });

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
    expect(mockFinalize).toHaveBeenCalledWith("run-example", "reviewer@example.test", undefined);
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
