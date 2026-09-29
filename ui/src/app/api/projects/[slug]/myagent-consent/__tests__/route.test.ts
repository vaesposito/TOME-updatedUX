/** @jest-environment node */

import { NextRequest } from "next/server";
import { MYAGENT_BROWSER_ACTION_HEADER } from "@/lib/tome/myagent-interactive";

const mockGetAuth = jest.fn();
const mockResolveProject = jest.fn();
const mockPermissions = jest.fn();
const mockUpdateOne = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindOne = jest.fn();
const mockAudit = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 500,
      public code = "INTERNAL_ERROR",
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuth(...args),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    withErrorHandler: (handler: (...args: unknown[]) => unknown) => async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (error) {
        if (error instanceof ApiError) {
          return Response.json(
            { success: false, error: error.message, code: error.code },
            { status: error.status },
          );
        }
        throw error;
      }
    },
  };
});

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => ({
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
    updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
  })),
}));

jest.mock("@/lib/tome/project-resolver", () => ({
  resolveUniqueTomeProjectBySlug: (...args: unknown[]) => mockResolveProject(...args),
}));

jest.mock("@/lib/tome/data-steward", () => ({
  getTomeProjectPermissions: (...args: unknown[]) => mockPermissions(...args),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAudit(...args),
  tomeActorFromAuth: jest.fn(() => ({ type: "user", id: "user-a" })),
}));

import { DELETE, PUT } from "../route";

const project = {
  _id: "project-id",
  slug: "example",
  type: "project",
  sources: {
    myagent_consents: [
      { subject: "other-user", connectors: ["salesforce"], granted_at: "2026-09-01T00:00:00Z" },
    ],
  },
};

function browserAuth() {
  return {
    user: { email: "user-a@example.test" },
    session: { authMethod: "session", principalType: "oidc_user", sub: "user-a" },
  };
}

function putRequest(
  connectors: unknown,
  revision: string | null = null,
  headerOverrides: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://example.test/api/projects/example/myagent-consent", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://example.test",
      [MYAGENT_BROWSER_ACTION_HEADER]: "1",
      ...headerOverrides,
    },
    body: JSON.stringify({ connectors, revision }),
  });
}

function deleteRequest(headerOverrides: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://example.test/api/projects/example/myagent-consent", {
    method: "DELETE",
    headers: {
      origin: "http://example.test",
      [MYAGENT_BROWSER_ACTION_HEADER]: "1",
      ...headerOverrides,
    },
  });
}

const ctx = { params: Promise.resolve({ slug: "example" }) };
const originalPublicOrigin = process.env.TOME_PUBLIC_ORIGIN;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;

describe("MyAgent consent endpoint", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuth.mockResolvedValue(browserAuth());
    mockResolveProject.mockResolvedValue(project);
    mockPermissions.mockResolvedValue({ canEdit: true });
    mockUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mockUpdateMany.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    mockFindOne.mockResolvedValue({
      ...project,
      sources: {
        myagent_consents: [
          ...project.sources.myagent_consents,
          { subject: "user-a", connectors: ["outlook"], granted_at: "2026-09-15T00:00:00Z" },
        ],
      },
    });
    process.env.TOME_PUBLIC_ORIGIN = "http://example.test";
    delete process.env.NEXTAUTH_URL;
  });

  afterAll(() => {
    if (originalPublicOrigin === undefined) delete process.env.TOME_PUBLIC_ORIGIN;
    else process.env.TOME_PUBLIC_ORIGIN = originalPublicOrigin;
    if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalNextAuthUrl;
  });

  it("requires a first-party browser session before granting", async () => {
    mockGetAuth.mockResolvedValue({
      user: { email: "user-a@example.test" },
      session: { authMethod: "bearer", principalType: "oidc_user", sub: "user-a" },
    });

    const response = await PUT(putRequest(["outlook"]), ctx);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "MYAGENT_INTERACTIVE_CONSENT_REQUIRED",
    });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it.each([
    ["missing explicit action", { [MYAGENT_BROWSER_ACTION_HEADER]: "0" }],
    ["foreign origin", { origin: "https://other.example.test" }],
    ["MCP forwarding hop", { "x-tome-mcp-forwarded": "1" }],
  ])("rejects a %s even with an otherwise valid browser session", async (_case, headers) => {
    const response = await PUT(putRequest(["outlook"], null, headers), ctx);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "MYAGENT_INTERACTIVE_CONSENT_REQUIRED",
    });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it.each([
    ["missing explicit action", { [MYAGENT_BROWSER_ACTION_HEADER]: "0" }],
    ["foreign origin", { origin: "https://other.example.test" }],
    ["MCP forwarding hop", { "x-tome-mcp-forwarded": "1" }],
  ])("rejects Disconnect from a %s", async (_case, headers) => {
    const response = await DELETE(deleteRequest(headers), ctx);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "MYAGENT_INTERACTIVE_CONSENT_REQUIRED",
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("enforces project-only and data-steward authorization before an upsert", async () => {
    mockResolveProject.mockResolvedValue({ ...project, type: "area" });
    const areaResponse = await PUT(putRequest(["outlook"]), ctx);
    expect(areaResponse.status).toBe(400);
    await expect(areaResponse.json()).resolves.toMatchObject({ code: "MYAGENT_PROJECT_ONLY" });

    mockResolveProject.mockResolvedValue(project);
    mockPermissions.mockResolvedValue({ canEdit: false });
    const deniedResponse = await PUT(putRequest(["outlook"]), ctx);
    expect(deniedResponse.status).toBe(403);
    await expect(deniedResponse.json()).resolves.toMatchObject({ code: "DATA_STEWARD_REQUIRED" });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("uses a subject-scoped Mongo pipeline rather than replacing consent records", async () => {
    const response = await PUT(putRequest(["OUTLOOK", "unknown"]), ctx);

    expect(response.status).toBe(200);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "project-id", $expr: expect.any(Object) },
      expect.any(Array),
    );
    const pipeline = mockUpdateOne.mock.calls[0][1];
    expect(JSON.stringify(pipeline)).toContain('"$literal":"user-a"');
    expect(JSON.stringify(pipeline)).not.toContain('"other-user","connectors":[]');
    await expect(response.json()).resolves.toMatchObject({
      data: { sources: { myagent_connectors: ["outlook"], myagent_enabled: true } },
    });
  });

  it("rejects a stale grant rather than re-authorizing after another tab changed consent", async () => {
    mockUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    const response = await PUT(putRequest(["outlook"], "old-revision"), ctx);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MYAGENT_CONSENT_CONFLICT",
    });
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(JSON.stringify(mockUpdateOne.mock.calls[0][0])).toContain("old-revision");
  });

  it("lets a former user self-revoke without resolving or disclosing project access", async () => {
    mockUpdateMany.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const response = await DELETE(deleteRequest(), ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { revoked: true, revision: expect.any(String) },
    });
    expect(mockResolveProject).not.toHaveBeenCalled();
    expect(mockPermissions).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "example", $expr: expect.any(Object) }),
      expect.any(Array),
    );
  });

  it("writes an editor-authorized tombstone when Disconnect wins a first-grant race", async () => {
    mockUpdateMany.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    mockUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const response = await DELETE(deleteRequest(), ctx);

    expect(response.status).toBe(200);
    expect(mockResolveProject).toHaveBeenCalledWith("example");
    expect(mockPermissions).toHaveBeenCalledWith(
      expect.objectContaining({ project, user: browserAuth().user }),
    );
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "project-id" },
      expect.any(Array),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { revoked: true, revision: expect.any(String) },
    });
  });

  it("keeps duplicate legacy slugs non-enumerating when no record exists", async () => {
    mockUpdateMany.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    mockResolveProject.mockRejectedValue({ code: "PROJECT_SLUG_AMBIGUOUS" });

    const response = await DELETE(deleteRequest(), ctx);

    expect(response.status).toBe(200);
    expect(mockUpdateOne).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: { revoked: true, revision: null },
    });
  });
});
