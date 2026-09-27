/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockReadRevision = jest.fn();
const mockFindRun = jest.fn();
const mockMayViewMyAgentRunEvidence = jest.fn();

class MockApiError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

jest.mock("@/lib/api-middleware", () => ({
  ApiError: MockApiError,
  successResponse: (data: unknown) => Response.json({ data }),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));

jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: async () => ({ readRevision: mockReadRevision }),
}));

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({ findOne: mockFindRun }),
}));

jest.mock("@/lib/tome/data-steward", () => ({
  tomeSessionSubject: jest.fn(() => "other-collaborator"),
}));

jest.mock("@/lib/projects/myagent-source", () => ({
  mayViewMyAgentRunEvidence: (...args: unknown[]) =>
    mockMayViewMyAgentRunEvidence(...args),
}));

const ctx = { params: Promise.resolve({ slug: "example", id: "rejected-revision" }) };

describe("GET page revision privacy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-example",
      session: { sub: "other-collaborator" },
      canManageSteward: false,
    });
    mockReadRevision.mockResolvedValue({
      _id: "rejected-revision",
      project_id: "project-example",
      path: "updates.md",
      markdown: "Private delegated evidence",
      status: "rejected",
      report_id: "delegated-report",
      created_at: new Date("2026-09-15T10:00:00Z"),
    });
    mockFindRun.mockResolvedValue({
      project_id: "project-example",
      report_id: "delegated-report",
      triggered_by_sub: "delegating-user",
      myagent_evidence_received: true,
    });
    mockMayViewMyAgentRunEvidence.mockReturnValue(false);
  });

  it("does not return a rejected delegated body to another collaborator", async () => {
    const { GET } = await import("../route");

    await expect(
      GET(
        new NextRequest(
          "http://localhost/api/tome/projects/example/revisions/rejected-revision",
        ),
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: "MYAGENT_EVIDENCE_PRIVATE",
    });
    expect(mockFindRun).toHaveBeenCalledWith({
      project_id: "project-example",
      report_id: "delegated-report",
      myagent_evidence_received: true,
    });
  });
});
