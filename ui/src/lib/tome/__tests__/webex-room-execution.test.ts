/** @jest-environment node */
import type { ProjectSources, WebexRoomSource } from "@/types/projects";
const mockCollect = jest.fn();
const mockManaged = jest.fn();
const mockShared = jest.fn();
jest.mock("@/lib/projects/onboarding-providers", () => ({
  collectForwardedCredentials: (...args: unknown[]) => mockCollect(...args),
}));
jest.mock("../managed-webex", () => ({
  normalizeWebexCredentialSettings: (request: unknown) => request,
  resolveManagedWebexCredential: (...args: unknown[]) => mockManaged(...args),
  listManagedWebexSharedRoomIds: (...args: unknown[]) => mockShared(...args),
}));
import { prepareWebexRooms, resolveWebexRoomExecution } from "../webex-room-execution";
const room: WebexRoomSource = { room_id: "room-a", name: "Room A", slug: "room-a" };
const originalFetch = global.fetch;
const defaults = { mode: "personal" as const, provider: "webex" };
const caller = { subject: "user-b", userEmail: "b@example.com" };
const prepare = (rooms: WebexRoomSource[], previousSources?: ProjectSources) =>
  prepareWebexRooms({ rooms, previousSources, ...caller, userName: "User B", defaults });
beforeEach(() => {
  jest.resetAllMocks();
  mockCollect.mockImplementation(async (subject, providers) => Object.fromEntries(providers.map((provider: string) => [provider, { access_token: `token-${subject}` }])));
  mockManaged.mockResolvedValue({ capability: { available: true, provider: "webex_messaging", accountEmail: "generic@example.com" }, accessToken: "managed-token" });
  mockShared.mockResolvedValue(new Set(["room-a"]));
  global.fetch = jest.fn(async (url) => new Response(JSON.stringify(String(url).endsWith("people/me")
    ? { displayName: "Resolved Account", emails: ["account@example.com"] } : { id: "room-a" })));
});
afterEach(() => { global.fetch = originalFetch; });

it.each(["personal", "managed"] as const)("records the authenticated adder for new %s rooms, ignoring forged attribution", async (mode) => {
  const result = await prepare([{ ...room, credential_mode: mode, credential_provider: "webex",
    added_by: { subject: "victim", name: "Fake", email: "fake@example.com", added_at: "fake" } }]);
  expect(result[0].added_by).toEqual({ subject: "user-b", name: "User B", email: "b@example.com", added_at: expect.any(String) });
  expect(result[0].credential_mode).toBe(mode);
  if (mode === "managed") expect(mockShared).toHaveBeenCalledWith(expect.objectContaining({ userEmail: "b@example.com" }));
});
it("preserves original attribution, mode and metadata when another editor retains a room", async () => {
  const original: WebexRoomSource = { ...room, credential_mode: "managed",
    added_by: { subject: "user-a", name: "User A", email: "a@example.com", added_at: "2026-01-01T00:00:00Z" } };
  expect(await prepare([{ ...room, credential_mode: "personal" }], { webex_rooms: [original] })).toEqual([original]);
  expect(mockCollect).not.toHaveBeenCalled();
  expect(mockShared).not.toHaveBeenCalled();
});
it("keeps legacy rooms unchanged, without guessing or backfilling an adder", async () => {
  expect(await prepare([room], { webex_rooms: [room], webex_credential_mode: "managed" })).toEqual([room]);
  expect(mockManaged).not.toHaveBeenCalled();
});
it.each(["manual-caller", "schedule-owner"])("uses %s's token for legacy personal rooms, never the adder's", async (subject) => {
  const resolved = await resolveWebexRoomExecution({ sources: { webex_rooms: [{ ...room,
    added_by: { subject: "old-adder", name: "Old Adder", email: "old@example.com", added_at: "" } }] },
    subject, purpose: "ingest" });
  expect(mockCollect).toHaveBeenCalledWith(subject, ["webex"]);
  expect(resolved.roomTokens).toEqual({ "room-a": `token-${subject}` });
});
it("ingests legacy managed rooms without the caller's connection or membership", async () => {
  mockCollect.mockResolvedValue({});
  mockShared.mockResolvedValue(new Set());
  const resolved = await resolveWebexRoomExecution({ ...caller, purpose: "ingest",
    sources: { webex_rooms: [room], webex_credential_mode: "managed" } });
  expect(resolved.checks[0].available).toBe(true);
  expect(resolved.roomTokens).toEqual({ "room-a": "managed-token" });
  expect(mockShared).not.toHaveBeenCalled();
  expect(mockManaged).toHaveBeenCalledWith({ force: true, requireMemberships: false });
});
it("still requires shared membership to add and remove managed rooms", async () => {
  mockShared.mockResolvedValue(new Set());
  const managed = { ...room, credential_mode: "managed" as const };
  await expect(prepare([managed])).rejects.toThrow("cannot add");
  await expect(prepare([], { webex_rooms: [managed] })).rejects.toThrow("access to remove");
  expect(mockShared).toHaveBeenCalledWith(expect.objectContaining({ userEmail: "b@example.com" }));
});
it("rejects removal of an inaccessible personal room, but preserves it on unrelated saves", async () => {
  global.fetch = jest.fn(async (url) => new Response("{}", { status: String(url).endsWith("people/me") ? 200 : 403 }));
  await expect(prepare([], { webex_rooms: [room] })).rejects.toThrow("access to remove");
  expect(await prepare([room], { webex_rooms: [room] })).toEqual([room]);
});
it("allows removal when the current user can access the room, regardless of who added it", async () => {
  expect(await prepare([], { webex_rooms: [room] })).toEqual([]);
});
it("uses separate tokens for mixed account types and reuses each account lookup", async () => {
  const rooms = [room, { ...room, room_id: "room-b", credential_mode: "managed" as const },
    { ...room, room_id: "room-c", credential_mode: "personal" as const }];
  const resolved = await resolveWebexRoomExecution({ ...caller, purpose: "ingest", sources: { webex_rooms: rooms } });
  expect(resolved.roomTokens).toEqual({ "room-a": "token-user-b", "room-b": "managed-token", "room-c": "token-user-b" });
  expect(mockCollect).toHaveBeenCalledTimes(1);
  expect(mockShared).not.toHaveBeenCalled();
  expect(JSON.stringify(resolved.checks)).not.toMatch(/token-user-b|managed-token/);
});
it("reports personal no-access without substituting the adder or generic account", async () => {
  global.fetch = jest.fn(async (url) => new Response("{}", { status: String(url).endsWith("people/me") ? 200 : 403 }));
  const resolved = await resolveWebexRoomExecution({ ...caller, purpose: "ingest", sources: { webex_rooms: [room] } });
  expect(resolved.checks[0]).toMatchObject({ available: false, access: "inaccessible", detail: "No access to Room A" });
  expect(resolved.roomTokens["room-a"]).toBe("token-user-b");
  expect(mockManaged).not.toHaveBeenCalled();
});
it("fails closed when managed access is lost and distinguishes network errors from missing membership", async () => {
  global.fetch = jest.fn(async () => { throw new Error("timeout"); });
  const resolved = await resolveWebexRoomExecution({ ...caller, purpose: "ingest",
    sources: { webex_rooms: [{ ...room, credential_mode: "managed" }] } });
  expect(resolved.checks[0]).toMatchObject({ available: false, access: "unknown" });
  expect(resolved.roomTokens).toEqual({});
});
