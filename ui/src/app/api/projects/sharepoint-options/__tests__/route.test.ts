/** @jest-environment node */
import { NextRequest } from "next/server";
const mockAuth = jest.fn();
const mockLoadProject = jest.fn();
const mockRequireEditor = jest.fn();
const mockRequest = jest.fn();
const mockConfigured = jest.fn();
const mockFolderPreview = jest.fn();
jest.mock("@/lib/api-middleware", () => ({ ...jest.requireActual("@/lib/api-middleware"), getAuthFromBearerOrSession: (...args: unknown[]) => mockAuth(...args) }));
jest.mock("@/lib/tome/tome-api", () => ({ loadTomeProject: (...args: unknown[]) => mockLoadProject(...args), requireTomeEditor: (...args: unknown[]) => mockRequireEditor(...args) }));
jest.mock("@/lib/tome/sharepoint", () => ({ sharePointConfigured: () => mockConfigured(), sharePointRequest: (...args: unknown[]) => mockRequest(...args), sharePointFolderPreview: (...args: unknown[]) => mockFolderPreview(...args) }));
import { GET } from "../route";
import { ApiError } from "@/lib/api-error";
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: "user@example.test" }, session: { sub: "user-1" } });
  mockConfigured.mockReturnValue(true);
  mockRequireEditor.mockImplementation(() => undefined);
  mockRequest.mockResolvedValue({ items: [], has_more: false });
});
it("forwards bounded search and pagination, never client-supplied upstream URLs", async () => {
  const response = await GET(new NextRequest("http://example.test/api/projects/sharepoint-options?drive_id=drive-1&q=example&cursor=page-2&project_slug=example"));
  expect(response.status).toBe(200);
  expect(mockLoadProject).toHaveBeenCalled();
  const [route, params] = mockRequest.mock.calls[0];
  expect(route).toBe("documents/catalog/items");
  expect(Object.fromEntries(params.entries())).toEqual({ drive_id: "drive-1", query: "example", cursor: "page-2", limit: "50" });
});
it("blocks a project viewer before exposing catalog results", async () => {
  mockRequireEditor.mockImplementation(() => { throw new ApiError("Editor required", 403); });
  expect((await GET(new NextRequest("http://example.test/api/projects/sharepoint-options?project_slug=example"))).status).toBe(403);
  expect(mockRequest).not.toHaveBeenCalled();
});
it("reports an unconfigured app without prompting user OAuth", async () => {
  mockConfigured.mockReturnValue(false);
  expect(await (await GET(new NextRequest("http://example.test/api/projects/sharepoint-options"))).json()).toMatchObject({ data: { configured: false, items: [] } });
  expect(mockRequest).not.toHaveBeenCalled();
});
it("rejects traversal identifiers", async () => {
  expect((await GET(new NextRequest("http://example.test/api/projects/sharepoint-options?drive_id=.."))).status).toBe(400);
  expect(mockRequest).not.toHaveBeenCalled();
});
it("previews a specific folder behind the same editor check, not a library root", async () => {
  mockFolderPreview.mockResolvedValue({ document_count: 2 });
  const response = await GET(new NextRequest("http://example.test/api/projects/sharepoint-options?drive_id=drive-1&folder_item_id=folder-1&preview=true&project_slug=example"));
  expect(response.status).toBe(200);
  expect(mockRequireEditor).toHaveBeenCalled();
  expect(mockFolderPreview).toHaveBeenCalledWith({ kind: "folder", drive_id: "drive-1", item_id: "folder-1", name: "folder-1" });
  expect((await GET(new NextRequest("http://example.test/api/projects/sharepoint-options?drive_id=drive-1&preview=true"))).status).toBe(400);
});
