/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockDeleteOne = jest.fn(async () => ({ deletedCount: 1 }));
const mockUpdateOne = jest.fn(async () => ({ modifiedCount: 1 }));
// Deleting an entity also clears its watchers.
const mockDeleteMany = jest.fn(async () => ({ deletedCount: 0 }));
const mockFindOne = jest.fn();
const mockFindBySlug = jest.fn();
const mockGetTomeProjectPermissions = jest.fn();
const mockRunOnboardingDeletes = jest.fn(async () => []);
const mockRemoveTomeReadAccess = jest.fn(async () => undefined);
const mockReconcileDataSteward = jest.fn(async () => undefined);
const mockInvalidateTomeReadAccessCatalogCache = jest.fn();
const mockDeleteReservation = jest.fn(async () => ({ deletedCount: 1 }));
const mockPrepareRooms = jest.fn();

jest.mock("@/lib/tome/webex-room-execution", () => ({
  prepareWebexRooms: (...args: unknown[]) => mockPrepareRooms(...args),
}));

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
    getAuthFromBearerOrSession: jest.fn(async () => ({
      user: { email: "steward@example.test" },
      session: {
        sub: "steward-subject",
        user: { email: "steward@example.test" },
      },
    })),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    withErrorHandler: (handler: (...args: unknown[]) => unknown) => async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (error) {
        if (
          error instanceof ApiError ||
          (error &&
            typeof error === "object" &&
            ("status" in error || "statusCode" in error) &&
            "code" in error)
        ) {
          const apiError = error as ApiError & { statusCode?: number };
          return Response.json(
            { success: false, error: apiError.message, code: apiError.code },
            { status: apiError.status ?? apiError.statusCode ?? 500 },
          );
        }
        throw error;
      }
    },
  };
});

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async (name: string) =>
    name === "project_slug_reservations"
      ? { deleteOne: mockDeleteReservation }
      : {
          findOne: mockFindOne,
          find: mockFindBySlug,
          deleteOne: mockDeleteOne,
          deleteMany: mockDeleteMany,
          updateOne: mockUpdateOne,
        },
  ),
}));

jest.mock("@/lib/auth-config", () => ({
  isBootstrapAdmin: jest.fn(() => false),
}));

jest.mock("@/lib/tome/data-steward", () => ({
  tomeSessionSubject: () => "steward-subject",
  dataStewardOpenFgaSubject: jest.fn(),
  getTomeProjectPermissions: (...args: unknown[]) =>
    mockGetTomeProjectPermissions(...args),
  reconcileDataSteward: (...args: unknown[]) =>
    mockReconcileDataSteward(...args),
  resolveDataSteward: jest.fn(async () => null),
  resolveStoredDataSteward: jest.fn(async () => null),
}));

jest.mock("@/lib/tome/access", () => ({
  getTomeReadConfiguration: jest.fn(),
  invalidateTomeReadAccessCatalogCache: () =>
    mockInvalidateTomeReadAccessCatalogCache(),
  reconcileTomeReadAccess: jest.fn(),
  removeTomeReadAccess: (...args: unknown[]) =>
    mockRemoveTomeReadAccess(...args),
}));

jest.mock("@/lib/projects/onboarding-providers", () => ({
  runOnboardingDeletes: (...args: unknown[]) =>
    mockRunOnboardingDeletes(...args),
  runOnboardingUpdates: jest.fn(),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: jest.fn(),
  tomeActorFromAuth: jest.fn(() => ({
    subject: "steward-subject",
    email: "steward@example.test",
  })),
}));

import { auditTome } from "@/lib/tome/audit";
import { DELETE, GET, PATCH } from "../route";

function request(slug: string): NextRequest {
  return new NextRequest(`http://example.test/api/projects/${slug}`, {
    method: "DELETE",
  });
}

function patchRequest(slug: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://example.test/api/projects/${slug}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function deleteEntity(type: "project" | "area" | "bhag") {
  const project = {
    _id: `${type}-id`,
    slug: `example-${type}`,
    name: `Example ${type}`,
    title: `Example ${type}`,
    type,
  };
  mockFindBySlug.mockReturnValue({
    limit: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([project]),
    }),
  });
  return DELETE(request(`example-${type}`), {
    params: Promise.resolve({ slug: `example-${type}` }),
  });
}

describe("DELETE /api/projects/[slug] authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTomeProjectPermissions.mockResolvedValue({
      canRead: true,
      canEdit: true,
      canManageSteward: false,
    });
  });

  it.each(["bhag", "area"] as const)(
    "denies a non-admin data steward deleting a %s",
    async (type) => {
      const response = await deleteEntity(type);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        success: false,
        code: "TOME_ADMIN_REQUIRED",
      });
      expect(mockRunOnboardingDeletes).not.toHaveBeenCalled();
      expect(mockDeleteOne).not.toHaveBeenCalled();
    },
  );

  it("allows a data steward to delete a regular project", async () => {
    const response = await deleteEntity("project");

    expect(response.status).toBe(200);
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: "project-id" });
    expect(mockDeleteReservation).toHaveBeenCalledWith({
      _id: "example-project",
      project_id: "project-id",
    });
    expect(mockInvalidateTomeReadAccessCatalogCache).toHaveBeenCalledTimes(1);
  });

  it("allows a Tome admin to delete a BHAG", async () => {
    mockGetTomeProjectPermissions.mockResolvedValue({
      canRead: true,
      canEdit: true,
      canManageSteward: true,
    });

    const response = await deleteEntity("bhag");

    expect(response.status).toBe(200);
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: "bhag-id" });
  });
});

describe("slug collision boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ["GET", GET],
    ["DELETE", DELETE],
  ] as const)("fails closed for ambiguous %s requests before authorization", async (_method, handler) => {
    mockFindBySlug.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: "first-id", slug: "duplicate", type: "project" },
          { _id: "second-id", slug: "duplicate", type: "project" },
        ]),
      }),
    });

    const response = await handler(request("duplicate"), {
      params: Promise.resolve({ slug: "duplicate" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROJECT_SLUG_AMBIGUOUS",
    });
    expect(mockGetTomeProjectPermissions).not.toHaveBeenCalled();
    expect(mockDeleteOne).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/projects/[slug] review policy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTomeProjectPermissions.mockResolvedValue({
      canRead: true,
      canEdit: true,
      canManageSteward: true,
    });
  });

  it("unsets the optional per-entity override when review_mode is null", async () => {
    const project = {
      _id: "area-id",
      slug: "example-area",
      name: "Example Area",
      title: "Example Area",
      type: "area",
      team_id: "example-team-id",
      team_slug: "example-team",
      team_name: "Example Team",
      review_mode: "none",
    };
    mockFindBySlug.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([project]),
      }),
    });
    mockFindOne.mockResolvedValue({ ...project, review_mode: undefined });

    const response = await PATCH(
      patchRequest("example-area", { review_mode: null }),
      { params: Promise.resolve({ slug: "example-area" }) },
    );

    expect(response.status).toBe(200);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "area-id" },
      {
        $set: { updated_at: expect.any(Date) },
        $unset: { review_mode: "" },
      },
    );
  });

  it("refuses MyAgent consent fields so stale project PATCHes cannot replace per-user scope", async () => {
    const project = {
      _id: "project-id",
      slug: "example-project",
      name: "Example Project",
      title: "Example Project",
      type: "project",
      team_id: "example-team-id",
      team_slug: "example-team",
      team_name: "Example Team",
      sources: {},
    };
    mockFindBySlug.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([project]),
      }),
    });

    const response = await PATCH(
      patchRequest("example-project", {
        sources: { myagent_connectors: ["outlook"], myagent_enabled: true },
      }),
      { params: Promise.resolve({ slug: "example-project" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "MYAGENT_CONSENT_ENDPOINT_REQUIRED",
    });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/projects/[slug] report visibility", () => {
  const project = {
    _id: "project-id",
    slug: "example-project",
    name: "Example Project",
    title: "Example Project",
    type: "project",
    team_id: "example-team-id",
    team_slug: "example-team",
    team_name: "Example Team",
    report_visibility: { enabled: false, standup: true, issues: true },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTomeProjectPermissions.mockResolvedValue({
      canRead: true,
      canEdit: true,
      canManageSteward: false,
    });
    mockFindBySlug.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([project]),
      }),
    });
  });

  it("allows a data steward to update report visibility and preserves omitted fields", async () => {
    mockFindOne.mockResolvedValue({
      ...project,
      report_visibility: { enabled: false, standup: false, issues: true },
    });

    const response = await PATCH(
      patchRequest("example-project", {
        report_visibility: { standup: false },
      }),
      { params: Promise.resolve({ slug: "example-project" }) },
    );

    expect(response.status).toBe(200);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "project-id" },
      {
        $set: {
          updated_at: expect.any(Date),
          report_visibility: {
            enabled: false,
            standup: false,
            issues: true,
          },
        },
      },
    );
  });

  it("rejects non-boolean report visibility fields", async () => {
    const response = await PATCH(
      patchRequest("example-project", {
        report_visibility: { issues: "sometimes" },
      }),
      { params: Promise.resolve({ slug: "example-project" }) },
    );

    expect(response.status).toBe(400);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});

describe("PATCH Webex source authorization and attribution", () => {
  const retained = { room_id: "other", name: "Other room", slug: "other" };
  const added = { room_id: "new", name: "New room", slug: "new", credential_mode: "managed", credential_provider: "webex_messaging" };
  const project = { _id: "example-id", slug: "example", type: "project", sources: { webex_rooms: [retained] } };
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrepareRooms.mockImplementation(async ({ rooms }) => rooms);
    mockGetTomeProjectPermissions.mockResolvedValue({ canRead: true, canEdit: true, canManageSteward: false });
    mockFindBySlug.mockReturnValue({ limit: () => ({ toArray: async () => [project] }) });
    mockFindOne.mockResolvedValue(project);
  });
  async function save() {
    return PATCH(patchRequest("example", { sources: { webex_rooms: [retained, added] } }), { params: Promise.resolve({ slug: "example" }) });
  }
  it("passes authenticated attribution and prior records to the shared validator", async () => {
    expect((await save()).status).toBe(200);
    expect(mockPrepareRooms).toHaveBeenCalledWith(expect.objectContaining({
      subject: "steward-subject", userEmail: "steward@example.test", previousSources: project.sources,
      rooms: expect.arrayContaining([expect.objectContaining(added)]),
    }));
  });
  it("rejects unauthorized project edits before checking Webex access", async () => {
    mockGetTomeProjectPermissions.mockResolvedValue({ canRead: true, canEdit: false });
    expect((await save()).status).toBe(403);
    expect(mockPrepareRooms).not.toHaveBeenCalled();
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/projects/[slug] Confluence multi-space sources", () => {
  const platformSpace = {
    slug: "platform",
    name: "Platform",
    space_key: "PLATFORM",
    base_url: "https://example.atlassian.net",
  };
  const project = {
    _id: "example-id",
    slug: "example",
    type: "project",
    sources: {
      confluence_url: "https://example.atlassian.net/wiki/spaces/PLATFORM",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTomeProjectPermissions.mockResolvedValue({
      canRead: true,
      canEdit: true,
      canManageSteward: false,
    });
    mockFindBySlug.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([project]),
      }),
    });
  });

  it("never puts sources.confluence_url in both $set and $unset, even though the client always sends both fields together", async () => {
    mockFindOne.mockResolvedValue({
      ...project,
      sources: { confluence_spaces: [platformSpace] },
    });

    const response = await PATCH(
      patchRequest("example", {
        sources: {
          // A real save always includes the legacy fields alongside the new
          // array.
          confluence_url: "",
          confluence_page_scopes: [],
          confluence_page_scope: null,
          confluence_spaces: [platformSpace],
        },
      }),
      { params: Promise.resolve({ slug: "example" }) },
    );

    expect(response.status).toBe(200);
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    const [, updateDoc] = mockUpdateOne.mock.calls[0];
    const setKeys = Object.keys(updateDoc.$set ?? {});
    const unsetKeys = Object.keys(updateDoc.$unset ?? {});
    expect(setKeys.filter((key) => unsetKeys.includes(key))).toEqual([]);
    expect(updateDoc.$set["sources.confluence_spaces"]).toEqual([platformSpace]);
    expect(updateDoc.$unset["sources.confluence_url"]).toBe("");
  });

  it("audits the legacy space as detached and the new space as attached when the array replaces it entirely", async () => {
    const marketingSpace = {
      slug: "marketing",
      name: "Marketing",
      space_key: "MARKETING",
      base_url: "https://example.atlassian.net",
    };
    mockFindOne.mockResolvedValue({
      ...project,
      sources: { confluence_spaces: [marketingSpace] },
    });

    await PATCH(
      patchRequest("example", {
        sources: { confluence_spaces: [marketingSpace] },
      }),
      { params: Promise.resolve({ slug: "example" }) },
    );

    expect(auditTome).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tome.source.detach",
        metadata: { source_type: "confluence", ref: "PLATFORM" },
      }),
    );
    expect(auditTome).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tome.source.attach",
        metadata: { source_type: "confluence", ref: "MARKETING" },
      }),
    );
  });

  it("does not spuriously re-attach the same space when it just carries over from the legacy URL into the array", async () => {
    mockFindOne.mockResolvedValue({
      ...project,
      sources: { confluence_spaces: [platformSpace] },
    });

    await PATCH(
      patchRequest("example", {
        sources: { confluence_spaces: [platformSpace] },
      }),
      { params: Promise.resolve({ slug: "example" }) },
    );

    expect(auditTome).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ source_type: "confluence" }) }),
    );
  });

  it("dedupes and caps confluence_spaces before storing them", async () => {
    const space = (key: string) => ({ ...platformSpace, slug: key.toLowerCase(), name: key, space_key: key });
    mockFindOne.mockResolvedValue({ ...project, sources: {} });

    const response = await PATCH(
      patchRequest("example", {
        sources: {
          confluence_spaces: [
            ...["A", "B", "C", "D", "E", "F", "G"].map(space),
            space("A"),
          ],
        },
      }),
      { params: Promise.resolve({ slug: "example" }) },
    );

    expect(response.status).toBe(200);
    const [, updateDoc] = mockUpdateOne.mock.calls[0];
    expect(
      updateDoc.$set["sources.confluence_spaces"].map((s: { space_key: string }) => s.space_key),
    ).toEqual(["A", "B", "C", "D", "E"]);
  });
});
