/** @jest-environment node */

import { NextRequest, NextResponse } from "next/server";

const mockLoad = jest.fn();
const mockList = jest.fn();
const mockRefresh = jest.fn();
const mockManaged = jest.fn();
jest.mock("@/lib/api-middleware", () => ({
  withErrorHandler: (handler: unknown) => handler,
  successResponse: (data: unknown) => NextResponse.json({ data }),
}));
jest.mock("@/lib/tome/tome-api", () => ({ loadTomeProject: (...args: unknown[]) => mockLoad(...args) }));
jest.mock("@/lib/tome/agent-proxy", () => ({ sessionSub: () => "current-user" }));
jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: async () => ({ listConnections: mockList, refreshConnection: mockRefresh }),
}));
jest.mock("@/lib/tome/managed-webex", () => ({
  ...jest.requireActual("@/lib/tome/managed-webex"),
  resolveManagedWebexCredential: (...args: unknown[]) => mockManaged(...args),
}));

import { GET } from "../route";

describe("saved Webex room access", () => {
  const originalFetch = global.fetch;
  const originalEmail = process.env.TOME_MANAGED_WEBEX_MESSAGING_ACCOUNT_EMAIL;
  const rooms = [{ room_id: "shared", name: "Shared room" }, { room_id: "other", name: "Other room" }];
  function project(mode = "personal") {
    mockLoad.mockResolvedValue({
      project: { sources: { webex_rooms: rooms, webex_credential_mode: mode, webex_credential_provider: "webex_messaging" } },
      session: { sub: "current-user" }, user: { email: "member@example.com" },
    });
  }
  async function request() {
    return (await (await GET(new NextRequest("https://example.test/api/tome/projects/example/webex-room-access"), {
      params: Promise.resolve({ slug: "example" }),
    })).json()).data;
  }
  beforeEach(() => {
    jest.clearAllMocks();
    project();
    mockList.mockResolvedValue([{ id: "mine", provider: "webex_messaging", status: "connected" }]);
    mockRefresh.mockResolvedValue({ accessToken: "personal-test-token" });
    mockManaged.mockResolvedValue({ capability: { available: true }, accessToken: "managed-test-token" });
    process.env.TOME_MANAGED_WEBEX_MESSAGING_ACCOUNT_EMAIL = "managed@example.com";
    global.fetch = jest.fn(async (url) => new Response("{}", { status: String(url).endsWith("/shared") ? 200 : 403 }));
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEmail === undefined) delete process.env.TOME_MANAGED_WEBEX_MESSAGING_ACCOUNT_EMAIL;
    else process.env.TOME_MANAGED_WEBEX_MESSAGING_ACCOUNT_EMAIL = originalEmail;
  });

  it("checks each saved ID using the caller's configured connection, independent of search results", async () => {
    const data = await request();
    expect(data.rooms).toEqual({ shared: "accessible", other: "inaccessible" });
    expect(mockList).toHaveBeenCalledWith({ type: "user", id: "current-user" });
    expect(mockRefresh).toHaveBeenCalledWith("mine");
    expect(global.fetch).toHaveBeenCalledWith("https://webexapis.com/v1/rooms/shared", expect.objectContaining({
      cache: "no-store", headers: { Authorization: "Bearer personal-test-token", Accept: "application/json" },
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(data)).not.toContain("test-token");
  });

  it("checks current-user membership in managed rooms without needing a personal connection", async () => {
    project("managed");
    global.fetch = jest.fn(async (url) => {
      const params = new URL(String(url)).searchParams;
      expect(params.get("personEmail")).toBe("member@example.com");
      return new Response(JSON.stringify({ items: params.get("roomId") === "shared" ? [{ roomId: "shared" }] : [] }));
    });
    expect(await request()).toMatchObject({ accountEmail: "managed@example.com", rooms: { shared: "accessible", other: "inaccessible" } });
    expect(mockList).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 429, 500])("reports HTTP %s as unknown, not non-membership", async (status) => {
    global.fetch = jest.fn(async () => new Response("{}", { status }));
    expect((await request()).rooms).toEqual({ shared: "unknown", other: "unknown" });
  });

  it("keeps individual managed lookup failures unknown while retaining successful membership checks", async () => {
    project("managed");
    global.fetch = jest.fn(async (url) => {
      if (new URL(String(url)).searchParams.get("roomId") === "other") throw new Error("timeout");
      return new Response(JSON.stringify({ items: [{ roomId: "shared" }] }));
    });
    expect((await request()).rooms).toEqual({ shared: "accessible", other: "unknown" });
  });

  it("leaves rooms unverified when the current user has no connection", async () => {
    mockList.mockResolvedValue([]);
    expect((await request()).rooms).toEqual({ shared: "unknown", other: "unknown" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not look up any rooms when project authorization fails", async () => {
    mockLoad.mockRejectedValue(new Error("Forbidden"));
    await expect(request()).rejects.toThrow("Forbidden");
    expect(mockList).not.toHaveBeenCalled();
    expect(mockManaged).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
