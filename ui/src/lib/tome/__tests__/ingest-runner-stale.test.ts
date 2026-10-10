/** @jest-environment node */

import { promoteOverdueRuns, reapStaleRuns } from "../ingest-runner";

const mockFind = jest.fn();
const mockFindRun = jest.fn();
const mockUpdateRun = jest.fn();
const mockUpdateProject = jest.fn();
const mockListDraftPaths = jest.fn();
const mockAudit = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: async () => ({ findOne: async () => null, updateOne: mockUpdateProject }),
}));
jest.mock("../mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({
    find: mockFind,
    findOne: mockFindRun,
    updateOne: mockUpdateRun,
  }),
}));
jest.mock("../page-store", () => ({
  getPageStore: async () => ({ listDraftPaths: mockListDraftPaths }),
}));
jest.mock("../audit", () => ({ auditTome: (...args: unknown[]) => mockAudit(...args) }));
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

const run = {
  _id: "run-example",
  project_id: "project-example",
  report_id: "report-example",
  status: "running",
  started_at: new Date("2026-01-01T00:00:00Z"),
  last_activity_at: new Date("2026-01-01T00:01:00Z"),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFind.mockReturnValue({ toArray: async () => [run] });
  mockFindRun.mockResolvedValue(run);
  mockUpdateRun.mockResolvedValue({ modifiedCount: 1 });
  mockListDraftPaths.mockResolvedValue([]);
});

describe("stale ingest recovery", () => {
  it("uses last agent activity, with a started-at fallback for older runs", async () => {
    mockFind.mockReturnValue({ toArray: async () => [] });

    await expect(reapStaleRuns(30 * 60 * 1000)).resolves.toBe(0);

    expect(mockFind).toHaveBeenCalledWith({
      status: "running",
      $or: [
        { last_activity_at: { $lt: expect.any(Date) } },
        { last_activity_at: { $exists: false }, started_at: { $lt: expect.any(Date) } },
      ],
    });
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it("holds an interrupted draft for manual review without an auto-promotion deadline", async () => {
    mockListDraftPaths.mockResolvedValue(["overview.md"]);

    await expect(reapStaleRuns(30 * 60 * 1000)).resolves.toBe(1);

    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.objectContaining({ _id: run._id, status: "running" }),
      {
        $set: {
          status: "awaiting_review",
          interrupted: true,
          error: "stale (worker restart or timeout)",
        },
        $unset: { review_deadline: "" },
      },
    );
    expect(mockUpdateProject).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "tome.ingest.awaiting_review",
      metadata: expect.objectContaining({ interrupted: true, phase: "reap" }),
    }));
  });

  it("fails and unlocks an interrupted run with no draft", async () => {
    await expect(reapStaleRuns(30 * 60 * 1000)).resolves.toBe(1);

    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.objectContaining({ _id: run._id, status: "running" }),
      { $set: expect.objectContaining({ status: "failed" }) },
    );
    expect(mockUpdateProject).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ locked: false }) },
    );
  });

  it("does not change a run that became active or terminal while the reaper was reading", async () => {
    mockUpdateRun.mockResolvedValue({ modifiedCount: 0 });

    await expect(reapStaleRuns(30 * 60 * 1000)).resolves.toBe(0);

    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockUpdateProject).not.toHaveBeenCalled();
  });

  it("never auto-promotes an interrupted draft even if it has a legacy deadline", async () => {
    mockFind.mockReturnValue({ toArray: async () => [{ ...run, status: "awaiting_review", interrupted: true }] });

    await expect(promoteOverdueRuns()).resolves.toBe(0);

    expect(mockUpdateRun).not.toHaveBeenCalled();
  });
});
