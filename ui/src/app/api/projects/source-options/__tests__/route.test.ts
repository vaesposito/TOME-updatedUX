/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockListConnections = jest.fn();
const mockRefreshConnection = jest.fn();
const mockResolveManagedWebexCredential = jest.fn();
const mockGetReadableWebexSpaceIds = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) =>
      mockGetAuthFromBearerOrSession(...args),
  };
});

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    listConnections: (...args: unknown[]) => mockListConnections(...args),
    refreshConnection: (...args: unknown[]) => mockRefreshConnection(...args),
  })),
}));

jest.mock("@/lib/feature-flags/credentials", () => ({
  getCredentialFeatureConfig: jest.fn(() => ({ enabled: true })),
}));

jest.mock("@/lib/tome/managed-webex", () => ({
  resolveManagedWebexCredential: (...args: unknown[]) =>
    mockResolveManagedWebexCredential(...args),
}));

jest.mock("@/lib/rbac/user-insights-scope", () => ({
  getReadableWebexSpaceIds: (...args: unknown[]) =>
    mockGetReadableWebexSpaceIds(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  subjectFromSession: (session: { sub?: string }) =>
    session.sub ? `user:${session.sub}` : null,
}));

import { GET } from "../route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/projects/source-options for Atlassian", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      session: { sub: "example-user" },
    });
    mockListConnections.mockResolvedValue([
      {
        id: "atlassian-connection",
        provider: "atlassian",
        status: "connected",
      },
    ]);
    mockRefreshConnection.mockResolvedValue({
      accessToken: "atlassian-token",
      expiresIn: 3600,
    });
    mockResolveManagedWebexCredential.mockResolvedValue({
      capability: {
        enabled: false,
        configured: false,
        available: false,
        provider: "webex_messaging",
        displayName: "Managed Webex account",
      },
    });
    mockGetReadableWebexSpaceIds.mockResolvedValue([]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("merges favorites, recent spaces, and a bounded browse page without refetching duplicate sites", async () => {
    let browseCalls = 0;
    let favoriteCalls = 0;
    let recentCalls = 0;
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname === "/oauth/token/accessible-resources") {
        return jsonResponse([
          {
            id: "cloud-example",
            url: "https://example.atlassian.net",
          },
          {
            id: "cloud-example",
            url: "https://example.atlassian.net/wiki",
          },
        ]);
      }
      if (url.pathname === "/me") {
        return jsonResponse({ account_id: "account-example" });
      }
      if (url.pathname.endsWith("/wiki/api/v2/spaces")) {
        if (url.searchParams.get("favorited-by")) {
          favoriteCalls += 1;
          return jsonResponse({
            results: [
              { key: "CORE", name: "Core Workspace", type: "global" },
            ],
          });
        }
        browseCalls += 1;
        return jsonResponse({
          results: [
            { key: "DOCS", name: "Team Documentation", type: "global" },
          ],
        });
      }
      if (url.pathname.endsWith("/wiki/rest/api/search")) {
        recentCalls += 1;
        expect(url.searchParams.get("cql")).toBe(
          "type=space order by lastmodified desc",
        );
        return jsonResponse({
          results: [
            {
              title: "Recently Active",
              space: { key: "RECENT", name: "Recently Active" },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://example.test/api/projects/source-options?provider=atlassian",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      connected: true,
      connectedTo: "example.atlassian.net",
      options: [
        {
          label: "Core Workspace (CORE)",
          value: "https://example.atlassian.net/wiki/spaces/CORE",
        },
        {
          label: "Recently Active (RECENT)",
          value: "https://example.atlassian.net/wiki/spaces/RECENT",
        },
        {
          label: "Team Documentation (DOCS)",
          value: "https://example.atlassian.net/wiki/spaces/DOCS",
        },
      ],
    });
    expect(favoriteCalls).toBe(1);
    expect(recentCalls).toBe(1);
    expect(browseCalls).toBe(1);
  });
});

describe("GET /api/projects/source-options for GitHub", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      session: { sub: "example-user" },
    });
    mockListConnections.mockResolvedValue([
      {
        id: "github-connection",
        provider: "github",
        status: "connected",
      },
    ]);
    mockRefreshConnection.mockResolvedValue({
      accessToken: "github-token",
      expiresIn: 3600,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retains stable repository identity and canonical metadata", async () => {
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname === "/user/repos") {
        return jsonResponse([
          {
            id: 42,
            node_id: "repository-node",
            full_name: "example/repository",
            html_url: "https://github.com/example/repository",
            default_branch: "trunk",
          },
        ]);
      }
      if (url.pathname === "/user") {
        return jsonResponse({ login: "example-user" });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://example.test/api/projects/source-options?provider=github",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.options).toEqual([
      {
        value: "https://github.com/example/repository",
        label: "example/repository",
        github_repo: {
          id: 42,
          node_id: "repository-node",
          full_name: "example/repository",
          html_url: "https://github.com/example/repository",
          default_branch: "trunk",
        },
      },
    ]);
  });
});

describe("GET /api/projects/source-options for Webex", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      session: { sub: "example-user" },
    });
    mockListConnections.mockResolvedValue([
      {
        id: "webex-connection",
        provider: "webex",
        status: "connected",
      },
    ]);
    mockRefreshConnection.mockResolvedValue({
      accessToken: "webex-token",
      expiresIn: 3600,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("requests and returns up to 1000 spaces ordered by recent activity", async () => {
    const rooms = Array.from({ length: 1000 }, (_, index) => ({
      id: `room-${index}`,
      title: `Room ${index}`,
    }));
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname === "/v1/rooms") {
        expect(url.searchParams.get("max")).toBe("1000");
        expect(url.searchParams.get("sortBy")).toBe("lastactivity");
        expect(url.searchParams.get("type")).toBe("group");
        return jsonResponse({ items: rooms });
      }
      if (url.pathname === "/v1/people/me") {
        return jsonResponse({ displayName: "Example User" });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://example.test/api/projects/source-options?provider=webex",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.connectedTo).toBe("Example User");
    expect(body.data.options).toHaveLength(1000);
    expect(body.data.options[0]).toEqual({
      value: "room-0",
      label: "Room 0",
    });
  });

  it("lists only caller-authorized rooms through the healthy managed account", async () => {
    mockResolveManagedWebexCredential.mockResolvedValue({
      capability: {
        enabled: true,
        configured: true,
        available: true,
        provider: "webex_messaging",
        displayName: "Managed Webex account",
      },
      accessToken: "managed-token",
    });
    mockGetReadableWebexSpaceIds.mockResolvedValue(["room-readable"]);
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname === "/v1/rooms") {
        return jsonResponse({
          items: [
            { id: "room-readable", title: "Readable Room" },
            { id: "room-hidden", title: "Hidden Room" },
          ],
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://example.test/api/projects/source-options?provider=webex&webex_mode=managed",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetReadableWebexSpaceIds).toHaveBeenCalledWith("user:example-user");
    expect(body.data).toMatchObject({
      connected: true,
      connectedTo: "Managed Webex account",
      options: [{ value: "room-readable", label: "Readable Room" }],
    });
  });
});
