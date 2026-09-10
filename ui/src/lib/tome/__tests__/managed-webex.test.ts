/** @jest-environment node */

const mockListConnections = jest.fn();
const mockRefreshConnection = jest.fn();
const mockResolveUserIdentitiesByEmail = jest.fn();

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    listConnections: (...args: unknown[]) => mockListConnections(...args),
    refreshConnection: (...args: unknown[]) => mockRefreshConnection(...args),
  })),
}));

jest.mock("@/lib/rbac/user-insights-scope", () => ({
  getReadableWebexSpaceIds: jest.fn(async () => []),
}));

jest.mock("@/lib/rbac/user-identity-directory", () => ({
  resolveUserIdentitiesByEmail: (...args: unknown[]) =>
    mockResolveUserIdentitiesByEmail(...args),
}));

import {
  clearManagedWebexHealthCache,
  getManagedWebexConfig,
  isProtectedManagedWebexConnection,
  normalizeWebexCredentialSettings,
  resolveManagedWebexCredential,
} from "../managed-webex";

const MANAGED_ENV = {
  TOME_MANAGED_WEBEX_MESSAGING_ENABLED: "true",
  TOME_MANAGED_WEBEX_MESSAGING_PROVIDER: "webex_messaging",
  TOME_MANAGED_WEBEX_MESSAGING_ACCOUNT_EMAIL: "managed@example.com",
};

describe("managed Webex credential", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(process.env, MANAGED_ENV);
    clearManagedWebexHealthCache();
    mockResolveUserIdentitiesByEmail.mockResolvedValue(
      new Map([
        [
          "managed@example.com",
          {
            subject: "managed-owner",
            email: "managed@example.com",
            name: "Managed Account",
            display_name: "managed@example.com",
          },
        ],
      ]),
    );
    mockListConnections.mockResolvedValue([
      {
        id: "connection-1",
        provider: "webex_messaging",
        owner: { type: "user", id: "managed-owner" },
        status: "connected",
      },
    ]);
    mockRefreshConnection.mockResolvedValue({ accessToken: "managed-token" });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("resolves the owner from the configured email and verifies the Webex identity", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(
        JSON.stringify({
          id: "person-1",
          orgId: "org-1",
          displayName: "Managed Account",
          emails: ["managed@example.com"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await resolveManagedWebexCredential({ force: true, fetchImpl });

    expect(result.capability.available).toBe(true);
    expect(result.accessToken).toBe("managed-token");
    expect(mockResolveUserIdentitiesByEmail).toHaveBeenCalledWith([
      "managed@example.com",
    ]);
    expect(mockListConnections).toHaveBeenCalledWith(
      { type: "user", id: "managed-owner" },
      { includeDisabled: true },
    );
  });

  it("fails closed when Webex returns a different identity", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(
        JSON.stringify({
          id: "person-1",
          orgId: "org-1",
          emails: ["someone-else@example.com"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await resolveManagedWebexCredential({ force: true, fetchImpl });

    expect(result.capability.available).toBe(false);
    expect(result.accessToken).toBeUndefined();
    expect(result.capability.reason).toMatch(/does not match/i);
  });

  it("keeps the managed connection outside generic token paths", () => {
    expect(
      isProtectedManagedWebexConnection({
        owner: {
          type: "user",
          id: "managed-owner",
          email: "managed@example.com",
        },
        provider: "webex_messaging",
      }),
    ).toBe(true);
    expect(
      isProtectedManagedWebexConnection({
        owner: {
          type: "user",
          id: "another-user",
          email: "someone-else@example.com",
        },
        provider: "webex_messaging",
      }),
    ).toBe(false);
  });

  it("normalizes legacy personal projects without rewriting them", () => {
    expect(normalizeWebexCredentialSettings({})).toEqual({
      mode: "personal",
      provider: "webex",
    });
    expect(
      normalizeWebexCredentialSettings({ mode: "managed", provider: "ignored" }),
    ).toEqual({ mode: "managed", provider: "webex_messaging" });
    expect(getManagedWebexConfig().accountEmail).toBe("managed@example.com");
  });

  it("stays unavailable until the configured account has signed in", async () => {
    mockResolveUserIdentitiesByEmail.mockResolvedValue(new Map());

    const result = await resolveManagedWebexCredential({ force: true });

    expect(result.capability.available).toBe(false);
    expect(result.capability.reason).toMatch(/has not signed in/i);
    expect(mockListConnections).not.toHaveBeenCalled();
  });
});
