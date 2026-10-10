/** @jest-environment node */

import { approveDraftRun, finalizeDraftFileReview } from "../ingest-runner";

const mockFindRun = jest.fn();
const mockUpdateRun = jest.fn();
const mockUpdateProject = jest.fn();
const mockFinalizeReport = jest.fn();
const mockListDraftPaths = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: async () => ({ findOne: async () => null, updateOne: mockUpdateProject }),
}));
jest.mock("../mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({ findOne: mockFindRun, updateOne: mockUpdateRun }),
}));
jest.mock("../page-store", () => ({
  getPageStore: async () => ({ listDraftPaths: mockListDraftPaths, finalizeDraftReport: mockFinalizeReport }),
}));
jest.mock("../audit", () => ({ auditTome: jest.fn() }));
jest.mock("../mycelium", () => ({ isMyceliumConfigured: () => false }));
jest.mock("../agent-proxy", () => ({}));
jest.mock("../github-source-reconciliation", () => ({}));
jest.mock("../github-issue-scope", () => ({}));
jest.mock("../github-issue-cache", () => ({}));
jest.mock("../page-templates-store", () => ({}));
jest.mock("../access", () => ({}));
jest.mock("../evaluation-store", () => ({}));
jest.mock("../rubric-evaluator", () => ({}));
jest.mock("../evidence-bundle", () => ({}));
jest.mock("../draft-quality", () => ({}));
jest.mock("../bhag", () => ({}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFindRun.mockResolvedValue({
    _id: "run-example",
    project_id: "project-example",
    report_id: "report-example",
    status: "awaiting_review",
    file_reviews: [{
      path: "first.md", decision: "accept",
      reviewed_by: "first-reviewer@example.test", reviewed_at: new Date("2026-01-01T00:00:00Z"),
    }, {
      path: "second.md", decision: "reject",
      reviewed_by: "first-reviewer@example.test", reviewed_at: new Date("2026-01-01T00:00:00Z"),
    }],
  });
  mockListDraftPaths.mockResolvedValue(["first.md", "second.md", "third.md"]);
});

describe("finalizeDraftFileReview", () => {
  it.each(["accept", "reject"] as const)("bulk %s persists a consistent outcome and replaces all draft decisions", async (decision) => {
    const accepted = decision === "accept" ? 3 : 0;
    const rejected = decision === "reject" ? 3 : 0;
    await expect(finalizeDraftFileReview("run-example", "reviewer@example.test", decision))
      .resolves.toEqual({ accepted, rejected });
    expect(mockListDraftPaths).toHaveBeenCalledWith("project-example", "report-example");
    expect(mockFinalizeReport).toHaveBeenCalledWith(
      "project-example", "report-example", decision === "accept" ? ["first.md", "second.md", "third.md"] : [],
    );
    expect(mockUpdateRun).toHaveBeenCalledWith(
      { _id: "run-example", status: "awaiting_review" },
      expect.objectContaining({ $set: expect.objectContaining({
        status: decision === "accept" ? "succeeded" : "failed",
        review_outcome: decision === "accept" ? "approved" : "rejected",
        file_reviews: ["first.md", "second.md", "third.md"].map((path) => ({
          path, decision, reviewed_by: "reviewer@example.test", reviewed_at: expect.any(Date),
        })),
      }) }),
    );
    expect(mockUpdateProject).toHaveBeenCalledWith(
      { _id: "project-example" }, { $set: { locked: false, updated_at: expect.any(Date) } },
    );
  });

  it("preserves individual decisions and reviewer attribution when finishing per-file review", async () => {
    mockListDraftPaths.mockResolvedValue(["first.md", "second.md"]);
    await expect(finalizeDraftFileReview("run-example", "reviewer@example.test"))
      .resolves.toEqual({ accepted: 1, rejected: 1 });
    expect(mockFinalizeReport).toHaveBeenCalledWith("project-example", "report-example", ["first.md"]);
    const update = mockUpdateRun.mock.calls[0][1];
    expect(update.$set.review_outcome).toBe("partially_approved");
    expect(update.$set).not.toHaveProperty("file_reviews");
  });

  it("does not mutate draft pages or run state if per-file review is incomplete", async () => {
    await expect(finalizeDraftFileReview("run-example", "reviewer@example.test"))
      .rejects.toThrow("1 draft file is still awaiting a decision");
    expect(mockFinalizeReport).not.toHaveBeenCalled();
    expect(mockUpdateRun).not.toHaveBeenCalled();
    expect(mockUpdateProject).not.toHaveBeenCalled();
  });

  it("requires individual file decisions before accepting an interrupted draft", async () => {
    mockFindRun.mockResolvedValue({
      _id: "run-example",
      project_id: "project-example",
      report_id: "report-example",
      status: "awaiting_review",
      interrupted: true,
    });

    await expect(approveDraftRun("run-example", "reviewer@example.test"))
      .rejects.toThrow("review each draft file");
    await expect(finalizeDraftFileReview("run-example", "reviewer@example.test", "accept"))
      .rejects.toThrow("review each draft file");
    expect(mockFinalizeReport).not.toHaveBeenCalled();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });
});
