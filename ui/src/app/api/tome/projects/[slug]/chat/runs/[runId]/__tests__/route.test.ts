/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockLoadOwnedChatRun = jest.fn();
const mockIsChatRunOrphaned = jest.fn();
const mockFailOrphanedChatRuns = jest.fn();
const mockStopChatRun = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));
jest.mock("@/lib/tome/chat-run-store", () => ({
  loadOwnedChatRun: (...args: unknown[]) => mockLoadOwnedChatRun(...args),
  isChatRunOrphaned: (...args: unknown[]) => mockIsChatRunOrphaned(...args),
  failOrphanedChatRuns: (...args: unknown[]) => mockFailOrphanedChatRuns(...args),
  stopChatRun: (...args: unknown[]) => mockStopChatRun(...args),
}));

import { DELETE, GET } from "../route";

const context = {
  params: Promise.resolve({ slug: "example-project", runId: "run-1" }),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    user: { email: "test-user@example.com" },
  });
  mockIsChatRunOrphaned.mockReturnValue(false);
  mockFailOrphanedChatRuns.mockResolvedValue(0);
});

describe("GET TOME chat run", () => {
  it("replays only frames after the requested SSE cursor", async () => {
    mockLoadOwnedChatRun.mockResolvedValue({
      _id: "run-1",
      project_id: "project-1",
      user_id: "test-user@example.com",
      status: "completed",
      events: [
        { id: 1, frame: 'event: token\ndata: {"text":"first"}' },
        { id: 2, frame: 'event: token\ndata: {"text":"second"}' },
        { id: 3, frame: "event: done\ndata: {}" },
      ],
    });

    const request = new NextRequest(
      "http://example.test/api/tome/projects/example-project/chat/runs/run-1",
      { headers: { "Last-Event-ID": "1" } },
    );
    const response = await GET(request, context);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("first");
    expect(body).toContain('id: 2\nevent: token\ndata: {"text":"second"}');
    expect(body).toContain("id: 3\nevent: done");
    expect(mockLoadOwnedChatRun).toHaveBeenCalledWith(
      "run-1",
      "project-1",
      "test-user@example.com",
    );
  });

  it("does not expose another user's run", async () => {
    mockLoadOwnedChatRun.mockResolvedValue(null);
    const request = new NextRequest(
      "http://example.test/api/tome/projects/example-project/chat/runs/run-1",
    );
    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });

  it("fails an orphaned run and closes the stream with an error", async () => {
    const orphaned = {
      _id: "run-1",
      project_id: "project-1",
      user_id: "test-user@example.com",
      status: "running",
      events: [{ id: 1, frame: 'event: token\ndata: {"text":"partial"}' }],
    };
    mockLoadOwnedChatRun
      .mockResolvedValueOnce(orphaned)
      .mockResolvedValueOnce(orphaned)
      .mockResolvedValue({
        ...orphaned,
        status: "failed",
        error: "This response stopped before it finished.",
      });
    mockIsChatRunOrphaned.mockReturnValue(true);
    mockFailOrphanedChatRuns.mockResolvedValue(1);

    const request = new NextRequest(
      "http://example.test/api/tome/projects/example-project/chat/runs/run-1",
    );
    const response = await GET(request, context);
    const body = await response.text();

    expect(mockFailOrphanedChatRuns).toHaveBeenCalledWith({ _id: "run-1" });
    expect(body).toContain('id: 1\nevent: token\ndata: {"text":"partial"}');
    expect(body).toContain(
      'event: error\ndata: {"message":"This response stopped before it finished."}',
    );
  });
});

describe("DELETE TOME chat run", () => {
  const request = () =>
    new NextRequest(
      "http://example.test/api/tome/projects/example-project/chat/runs/run-1",
      { method: "DELETE" },
    );

  it("stops the caller's own run", async () => {
    mockLoadOwnedChatRun.mockResolvedValue({ _id: "run-1", status: "running" });
    mockStopChatRun.mockResolvedValue(true);

    const response = await DELETE(request(), context);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ stopped: true });
    expect(mockStopChatRun).toHaveBeenCalledWith("run-1", "project-1", "test-user@example.com");
  });

  it("does not stop another user's run", async () => {
    mockLoadOwnedChatRun.mockResolvedValue(null);

    const response = await DELETE(request(), context);

    expect(response.status).toBe(404);
    expect(mockStopChatRun).not.toHaveBeenCalled();
  });
});
