/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";
const mockLoad = jest.fn();
const mockResolve = jest.fn();
jest.mock("@/lib/api-middleware", () => ({ withErrorHandler: (fn: unknown) => fn,
  successResponse: (data: unknown) => NextResponse.json({ data }) }));
jest.mock("@/lib/tome/tome-api", () => ({ loadTomeProject: (...args: unknown[]) => mockLoad(...args) }));
jest.mock("@/lib/tome/agent-proxy", () => ({ sessionSub: () => "viewer" }));
jest.mock("@/lib/tome/webex-room-execution", () => ({ resolveWebexRoomExecution: (...args: unknown[]) => mockResolve(...args) }));
import { GET } from "../route";
it("checks the viewer's editing access and never returns credentials", async () => {
  const sources = { webex_rooms: [{ room_id: "room-a", name: "Room A" }] };
  mockLoad.mockResolvedValue({ project: { sources }, session: {}, user: { email: "viewer@example.com" } });
  mockResolve.mockResolvedValue({ checks: [{ room_id: "room-a", available: false }],
    roomTokens: { "room-a": "private-token" } });
  const response = await GET(new NextRequest("https://example.test/access"), { params: Promise.resolve({ slug: "example" }) });
  expect(mockResolve).toHaveBeenCalledWith({ sources, subject: "viewer", userEmail: "viewer@example.com", purpose: "edit" });
  expect(await response.text()).not.toContain("private-token");
});
