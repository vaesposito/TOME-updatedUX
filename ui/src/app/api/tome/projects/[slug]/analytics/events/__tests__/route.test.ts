/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockUpdateOne = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));
jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeUsageEventsCollection: jest.fn().mockImplementation(async () => ({
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
  })),
}));
jest.mock("@/lib/tome/audit", () => ({
  tomeActorFromAuth: jest.fn().mockReturnValue({ type: "user", id: "subject-1" }),
  hashTomeSubject: jest.fn().mockReturnValue("sha256:subject-1"),
}));
jest.mock("@/lib/tome/page-store", () => ({
  safePagePath: (path: string) => {
    if (!path.endsWith(".md") || path.includes("..")) throw new Error("invalid");
    return path;
  },
}));

import { POST } from "@/app/api/tome/projects/[slug]/analytics/events/route";

const context = { params: Promise.resolve({ slug: "example-project" }) };

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    project: { slug: "example-project" },
    user: { email: "test-user@example.test" },
    session: { sub: "subject-1" },
  });
  mockUpdateOne.mockResolvedValue({ acknowledged: true });
});

describe("POST Tome usage event", () => {
  it("records a server-attributed, idempotent page view", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/tome/projects/example-project/analytics/events", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event_12345678",
          analyticsSessionId: "session_12345678",
          viewKind: "page",
          pagePath: "architecture.md",
          subjectHash: "untrusted",
        }),
      }),
      context,
    );

    expect(response.status).toBe(202);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { event_id: "event_12345678" },
      {
        $setOnInsert: expect.objectContaining({
          event_id: "event_12345678",
          subject_hash: "sha256:subject-1",
          project_id: "project-1",
          project_slug: "example-project",
          view_kind: "page",
          page_path: "architecture.md",
        }),
      },
      { upsert: true },
    );
  });

  it("rejects a page event without a safe Markdown path", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/tome/projects/example-project/analytics/events", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event_12345678",
          analyticsSessionId: "session_12345678",
          viewKind: "page",
          pagePath: "../secret.md",
        }),
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});
