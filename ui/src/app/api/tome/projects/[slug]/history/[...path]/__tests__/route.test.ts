/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockPageHistory = jest.fn();
const mockFindRuns = jest.fn();
const mockMayViewMyAgentRunEvidence = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  successResponse: (data: unknown) => Response.json({ data }),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));

jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: async () => ({ pageHistory: mockPageHistory }),
}));

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({ find: mockFindRuns }),
}));

jest.mock("@/lib/tome/data-steward", () => ({
  tomeSessionSubject: jest.fn(() => "other-collaborator"),
}));

jest.mock("@/lib/projects/myagent-source", () => ({
  mayViewMyAgentRunEvidence: (...args: unknown[]) =>
    mockMayViewMyAgentRunEvidence(...args),
}));

describe("page history status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-example",
      session: { sub: "other-collaborator" },
      canManageSteward: false,
    });
    mockFindRuns.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    mockMayViewMyAgentRunEvidence.mockReturnValue(false);
  });

  it("identifies the current live revision instead of the newest draft", async () => {
    mockPageHistory.mockResolvedValue([
      {
        _id: "draft-revision",
        path: "charter.md",
        author: "agent@example.test",
        message: "draft update",
        created_at: new Date("2026-09-04T13:34:21Z"),
        status: "draft",
      },
      {
        _id: "live-revision",
        path: "charter.md",
        author: "editor@example.test",
        message: "published update",
        created_at: new Date("2026-08-25T14:32:01Z"),
      },
    ]);

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest("http://localhost/api/tome/projects/example/history/charter.md"),
      { params: Promise.resolve({ slug: "example", path: ["charter.md"] }) },
    );
    const body = await response.json();

    expect(body.data.current_revision_id).toBe("live-revision");
    expect(body.data.revisions).toEqual([
      expect.objectContaining({ id: "draft-revision", status: "draft" }),
      expect.objectContaining({ id: "live-revision", status: "live" }),
    ]);
  });

  it("hides a rejected MyAgent revision from a non-owner's history", async () => {
    mockPageHistory.mockResolvedValue([
      {
        _id: "rejected-delegated-revision",
        path: "updates.md",
        author: "tome-agent",
        message: "delegated update",
        created_at: new Date("2026-09-15T10:00:00Z"),
        report_id: "delegated-report",
        status: "rejected",
      },
      {
        _id: "live-revision",
        path: "updates.md",
        author: "editor@example.test",
        message: "published update",
        created_at: new Date("2026-09-14T10:00:00Z"),
        status: "live",
      },
    ]);
    mockFindRuns.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          report_id: "delegated-report",
          triggered_by_sub: "delegating-user",
          myagent_evidence_received: true,
        },
      ]),
    });

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest("http://localhost/api/tome/projects/example/history/updates.md"),
      { params: Promise.resolve({ slug: "example", path: ["updates.md"] }) },
    );
    const body = await response.json();

    expect(mockFindRuns).toHaveBeenCalledWith({
      project_id: "project-example",
      report_id: { $in: ["delegated-report"] },
      myagent_evidence_received: true,
    });
    expect(body.data.revisions).toEqual([
      expect.objectContaining({ id: "live-revision", status: "live" }),
    ]);
  });
});
