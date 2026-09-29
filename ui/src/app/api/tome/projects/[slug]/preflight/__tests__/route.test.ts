/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";
const mockLoadProject = jest.fn();
const mockResolveCredentials = jest.fn();
const mockRooms = jest.fn();
const mockMyAgentCredential = jest.fn();
jest.mock("@/lib/api-middleware", () => ({
  withErrorHandler: (handler: unknown) => handler, successResponse: (data: unknown) => NextResponse.json({ data }),
}));
jest.mock("@/lib/tome/tome-api", () => ({ loadTomeProject: (...args: unknown[]) => mockLoadProject(...args) }));
jest.mock("@/lib/tome/agent-proxy", () => ({
  sessionSub: () => "caller", resolveCredentialsForSub: (...args: unknown[]) => mockResolveCredentials(...args),
}));
jest.mock("@/lib/tome/webex-room-execution", () => ({ resolveWebexRoomExecution: (...args: unknown[]) => mockRooms(...args) }));
jest.mock("@/lib/tome/myagent-webex", () => ({ resolveMyAgentWebexCredential: (...args: unknown[]) => mockMyAgentCredential(...args) }));
import { POST } from "../route";

const rooms = [{ room_id: "room-a", name: "Room A" }, { room_id: "room-b", name: "Room B" }];
beforeEach(() => {
  jest.clearAllMocks();
  mockLoadProject.mockResolvedValue({ project: { sources: { webex_rooms: rooms } }, session: { sub: "caller" } });
  mockResolveCredentials.mockResolvedValue({});
  mockMyAgentCredential.mockResolvedValue({ available: true });
  mockRooms.mockResolvedValue({ checks: rooms.map((room) => ({ ...room, mode: "managed", available: true, access: "accessible" })), roomTokens: { "room-a": "secret-token" } });
});
async function request() {
  return (await (await POST(new NextRequest("https://example.test/preflight"), { params: Promise.resolve({ slug: "example" }) })).json()).data;
}
it("allows an authorized caller without Webex access to ingest the saved delegations", async () => {
  const result = await request();
  expect(mockRooms).toHaveBeenCalledWith(expect.objectContaining({ sources: { webex_rooms: rooms }, subject: "caller", purpose: "ingest" }));
  expect(result.can_ingest).toBe(true);
  expect(result.sources[0].accessible).toEqual(["Room A", "Room B"]);
  expect(JSON.stringify(result)).not.toContain("secret-token");
});
it("reports the failed bound account instead of telling the caller to connect", async () => {
  mockRooms.mockResolvedValue({ checks: [{ ...rooms[0], mode: "managed", available: false, detail: "Account A needs reconnection" }], roomTokens: {} });
  const result = await request();
  expect(result.can_ingest).toBe(false);
  expect(result.sources[0]).toMatchObject({ inaccessible: ["Room A"], fixable_by_user: false, detail: "Room A: Account A needs reconnection" });
});
it("checks managed rooms and only the current caller's MyAgent consent together", async () => {
  mockLoadProject.mockResolvedValue({ project: { sources: {
    webex_rooms: rooms,
    myagent_consents: [
      { subject: "caller", connectors: ["outlook"], granted_at: "2026-01-01T00:00:00Z" },
      { subject: "other-user", connectors: ["salesforce"], granted_at: "2026-01-01T00:00:00Z" },
    ],
  } }, session: { sub: "caller" } });
  const result = await request();
  expect(result.can_ingest).toBe(true);
  expect(result.sources).toEqual([
    expect.objectContaining({ provider: "webex", accessible: ["Room A", "Room B"] }),
    expect.objectContaining({ provider: "myagent", unverified: ["Outlook"], connection_ready: true }),
  ]);
  expect(mockMyAgentCredential).toHaveBeenCalledWith("caller");
  expect(JSON.stringify(result)).not.toContain("Salesforce");
  expect(JSON.stringify(result)).not.toContain("secret-token");
});
