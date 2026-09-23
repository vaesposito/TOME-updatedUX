/** @jest-environment node */

import { NextRequest, NextResponse } from "next/server";

const mockLoadProject = jest.fn();
const mockResolveCredentials = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  withErrorHandler: (handler: unknown) => handler,
  successResponse: (data: unknown) => NextResponse.json({ data }),
}));
jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadProject(...args),
}));
jest.mock("@/lib/tome/agent-proxy", () => ({
  sessionSub: () => "current-user",
  resolveProjectCredentials: (...args: unknown[]) => mockResolveCredentials(...args),
}));

import { POST } from "../route";

describe("Webex preflight run-as identity", () => {
  const originalFetch = global.fetch;
  const rooms = [
    { room_id: "room-1", name: "First space" },
    { room_id: "room-2", name: "Second space" },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadProject.mockResolvedValue({
      project: { owner_id: "creator@example.com", sources: { webex_rooms: rooms } },
      user: { email: "caller@example.com" },
      session: { sub: "current-user" },
    });
    mockResolveCredentials.mockResolvedValue({ webex: { access_token: "test-token" } });
    global.fetch = jest.fn(async (url) => new Response(JSON.stringify(
      String(url).endsWith("/people/me")
        ? { displayName: "Connected Account", emails: ["connected@example.com"], id: "private-profile-id" }
        : {},
    ), { status: 200 }));
  });

  afterEach(() => { global.fetch = originalFetch; });

  async function request() {
    const response = await POST(new NextRequest("https://example.test/api/tome/projects/example/preflight"), {
      params: Promise.resolve({ slug: "example" }),
    });
    return (await response.json()).data;
  }

  it("uses the triggering user's resolved token, not the project creator, and looks up the profile once", async () => {
    const data = await request();
    expect(mockResolveCredentials).toHaveBeenCalledWith(
      expect.anything(), "current-user", { purpose: "ingest", userEmail: "caller@example.com" },
    );
    expect(data.sources[0]).toMatchObject({
      accessible: ["First space", "Second space"],
      run_as: { mode: "personal", name: "Connected Account", email: "connected@example.com" },
    });
    const profileCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith("/people/me"));
    expect(profileCalls).toHaveLength(1);
    expect(profileCalls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer test-token" }, signal: expect.any(AbortSignal),
    });
    expect(JSON.stringify(data)).not.toMatch(/test-token|private-profile-id|creator@example.com/);
  });

  it("identifies the managed account using the managed token", async () => {
    mockLoadProject.mockResolvedValue({
      project: { sources: { webex_rooms: rooms, webex_credential_mode: "managed" } },
      user: { email: "caller@example.com" }, session: { sub: "current-user" },
    });
    mockResolveCredentials.mockResolvedValue({ webex: { access_token: "managed-test-token" } });
    const data = await request();
    expect(data.sources[0].run_as).toEqual({
      mode: "managed", name: "Connected Account", email: "connected@example.com",
    });
    expect(global.fetch).toHaveBeenCalledWith("https://webexapis.com/v1/people/me", expect.objectContaining({
      headers: { Authorization: "Bearer managed-test-token", Accept: "application/json" },
    }));
  });

  it("preserves room access results if profile lookup times out", async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith("/people/me")) throw new Error("timeout");
      return new Response("{}", { status: 200 });
    });
    const data = await request();
    expect(data.can_ingest).toBe(true);
    expect(data.sources[0].run_as).toEqual({ mode: "personal", name: "Your Webex connection" });
  });

  it("does not claim a run-as identity when no token is available", async () => {
    mockResolveCredentials.mockResolvedValue({});
    const data = await request();
    expect(data.sources[0].no_token).toBe(true);
    expect(data.sources[0].run_as).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
