/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";

const mockLoadProject = jest.fn();
const mockRosterPage = jest.fn();
const mockWatcherCount = jest.fn();
const mockCollection = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  withErrorHandler: (handler: unknown) => handler,
  successResponse: (data: unknown) => NextResponse.json({ data }),
}));
jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadProject(...args),
}));
jest.mock("@/lib/rbac/team-membership-store", () => ({
  loadActiveTeamMembersPage: (...args: unknown[]) => mockRosterPage(...args),
}));
jest.mock("@/lib/tome/watchers", () => ({
  countEntityWatchers: (...args: unknown[]) => mockWatcherCount(...args),
}));
jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockCollection(...args),
}));

import { GET } from "../route";

/** The directory, as a collection whose find() returns these rows. */
function directory(rows: unknown[]) {
  mockCollection.mockResolvedValue({
    find: () => ({ toArray: async () => rows }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadProject.mockResolvedValue({
    project: {
      slug: "example-project",
      team_slug: "platform-guild",
      team_name: "Platform Guild",
      owner_id: "lead@example.com",
      data_steward: { type: "team", id: "platform-guild", name: "Platform Guild" },
    },
  });
  mockRosterPage.mockResolvedValue({
    members: [
      { identity_key: "a", user_email: "lead@example.com", role: "owner", source_types: ["okta"], idp_managed: true },
      { identity_key: "b", user_email: "dev@example.com", role: "member", source_types: ["manual"], idp_managed: false },
    ],
    total: 2,
  });
  mockWatcherCount.mockResolvedValue(4);
  directory([
    { email: "lead@example.com", name: "Dana Okafor", avatar_url: "https://example.com/a.png" },
    { email: "dev@example.com", name: "Jordan Mapfumo" },
  ]);
});

async function request() {
  const response = await GET(new NextRequest("https://example.test/team"), {
    params: Promise.resolve({ slug: "example-project" }),
  });
  return (await response.json()).data;
}

it("names the roster from the directory and keeps each member's role", async () => {
  const result = await request();
  expect(result.team).toEqual({ slug: "platform-guild", name: "Platform Guild" });
  expect(result.members).toEqual([
    {
      email: "lead@example.com",
      name: "Dana Okafor",
      avatar_url: "https://example.com/a.png",
      role: "owner",
      idp_managed: true,
    },
    {
      email: "dev@example.com",
      name: "Jordan Mapfumo",
      avatar_url: null,
      role: "member",
      idp_managed: false,
    },
  ]);
  expect(result.total).toBe(2);
  expect(result.watchers).toBe(4);
  expect(result.steward).toBe("Platform Guild");
});

it("reads the roster of the owning team, owner first", async () => {
  await request();
  expect(mockRosterPage).toHaveBeenCalledWith(
    "platform-guild",
    expect.objectContaining({ ownerEmail: "lead@example.com" }),
  );
});

it("asks for a bounded page, so a very large team costs no more", async () => {
  await request();
  const [, options] = mockRosterPage.mock.calls[0];
  expect(options.pageSize).toBeLessThanOrEqual(25);
});

it("falls back to the address for a member the directory has no name for", async () => {
  directory([]);
  const result = await request();
  expect(result.members.map((m: { name: string }) => m.name)).toEqual([
    "lead@example.com",
    "dev@example.com",
  ]);
});

it("reports a project with no owning team rather than reading every roster", async () => {
  mockLoadProject.mockResolvedValue({ project: { slug: "example-project" } });
  const result = await request();
  expect(mockRosterPage).not.toHaveBeenCalled();
  expect(result.team).toBeNull();
  expect(result.members).toEqual([]);
  expect(result.total).toBe(0);
});

it("still answers when the watcher count cannot be read", async () => {
  mockWatcherCount.mockRejectedValue(new Error("mongo down"));
  const result = await request();
  expect(result.watchers).toBe(0);
  expect(result.members).toHaveLength(2);
});

it("reports no steward rather than an empty label when none is assigned", async () => {
  mockLoadProject.mockResolvedValue({
    project: { slug: "example-project", team_slug: "platform-guild" },
  });
  const result = await request();
  expect(result.steward).toBeNull();
});

it("refuses a caller who cannot read the project", async () => {
  mockLoadProject.mockRejectedValue(new Error("Forbidden"));
  await expect(request()).rejects.toThrow("Forbidden");
  expect(mockRosterPage).not.toHaveBeenCalled();
});
