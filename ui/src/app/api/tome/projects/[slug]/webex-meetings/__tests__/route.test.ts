/** @jest-environment node */

import { NextRequest, NextResponse } from "next/server";

const mockListConnectors = jest.fn();
const mockManualWebexProvider = jest.fn();
const mockManualWebexAccessToken = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  withErrorHandler: (handler: unknown) => handler,
  successResponse: (data: unknown) => NextResponse.json({ data }),
}));
jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: jest.fn(async () => ({ session: { sub: "test-user" } })),
}));
jest.mock("@/lib/tome/agent-proxy", () => ({ sessionSub: () => "test-user" }));
jest.mock("@/lib/tome/webex-meeting-series", () => ({
  manualWebexProvider: () => mockManualWebexProvider(),
  manualWebexAccessToken: (...args: unknown[]) => mockManualWebexAccessToken(...args),
}));
jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getOAuthConnectorService: async () => ({ listConnectors: mockListConnectors }),
}));

import { GET } from "../route";

describe("manual meeting connection metadata", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockListConnectors.mockResolvedValue([
      { id: "connector-1", provider: "webex", name: "Webex (Legacy)" },
      { id: "connector-2", provider: "custom_meetings", name: "Team Meetings" },
    ]);
    mockManualWebexProvider.mockReturnValue("custom_meetings");
    mockManualWebexAccessToken.mockResolvedValue(undefined);
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ items: [] })));
  });

  afterEach(() => { global.fetch = originalFetch; });

  async function request() {
    const res = await GET(new NextRequest("http://example.test/api/tome/projects/example/webex-meetings"), {
      params: Promise.resolve({ slug: "example" }),
    });
    return (await res.json()).data;
  }

  it("returns the exact configured connector name even without a user connection", async () => {
    expect(await request()).toEqual({
      meetings: [], connection: { provider: "custom_meetings", name: "Team Meetings" },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("preserves an admin-renamed legacy connector name when connected", async () => {
    mockManualWebexProvider.mockReturnValue("webex");
    mockManualWebexAccessToken.mockResolvedValue("test-token");
    expect(await request()).toEqual({
      meetings: [], connection: { provider: "webex", name: "Webex (Legacy)" },
    });
  });

  it("does not turn an unrecognized provider ID into a display name", async () => {
    mockManualWebexProvider.mockReturnValue("missing_provider");
    expect((await request()).connection).toEqual({ provider: "missing_provider", name: null });
  });
});
