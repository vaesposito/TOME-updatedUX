/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api-error";

const mockLoadProject = jest.fn();
const mockRequireEditor = jest.fn();
const mockStart = jest.fn();
const mockCascade = jest.fn();
const mockPrefetchMeetings = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  ApiError: jest.requireActual("@/lib/api-error").ApiError,
  withErrorHandler: (handler: unknown) => handler,
  successResponse: (data: unknown) => NextResponse.json({ data }),
}));
jest.mock("@/lib/tome/tome-api", () => ({ loadTomeProject: (...args: unknown[]) => mockLoadProject(...args), requireTomeEditor: () => mockRequireEditor() }));
jest.mock("@/lib/tome/ingest-runner", () => ({
  startIngestRun: (...args: unknown[]) => mockStart(...args), enqueueBhagCascade: (...args: unknown[]) => mockCascade(...args),
  isIngestRunning: async () => false, IngestInProgressError: class extends Error {},
}));
jest.mock("@/lib/tome/audit", () => ({ auditTome: jest.fn(), tomeActorFromAuth: () => ({}) }));
jest.mock("@/lib/tome/myagent-interactive", () => ({ isMyAgentInteractiveBrowserIngest: () => false }));
jest.mock("@/lib/tome/data-steward", () => ({ tomeSessionSubject: () => "test-user", getTomeProjectPermissions: jest.fn() }));
jest.mock("@/lib/tome/bhag", () => ({ resolveAreaChildren: async () => [], resolveBhagChildren: async () => [] }));
jest.mock("@/lib/tome/access", () => ({ listReadableTomeProjects: async () => [] }));
jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/tome/webex-meeting-series", () => ({ prefetchManualWebexMeetingTranscripts: (...args: unknown[]) => mockPrefetchMeetings(...args) }));

import { POST as ingest } from "../route";
import { POST as synthesize } from "../../synthesize/route";

const originalFetch = global.fetch;
const originalEnv = { agent: process.env.TOME_AGENT_URL, sharepoint: process.env.TOME_SHAREPOINT_API_URL, token: process.env.TOME_SHAREPOINT_API_TOKEN };
const saved = { drive_id: "drive-1", item_id: "saved", name: "Saved.pdf" };
const document = { drive_id: "drive-1", item_id: "context", name: "Context.pptx" };
let project: { type: string; sources: { sharepoint_documents: typeof saved[] } };

beforeEach(() => {
  jest.clearAllMocks();
  project = { type: "project", sources: { sharepoint_documents: [saved] } };
  mockLoadProject.mockImplementation(async () => ({ project, session: { sub: "test-user" }, user: { email: "test-user@example.test" } }));
  mockRequireEditor.mockImplementation(() => {});
  mockStart.mockResolvedValue({ runId: "new-run" });
  mockCascade.mockResolvedValue({ parentRunId: "parent-run", cascadeId: "cascade-1", childCount: 0 });
  mockPrefetchMeetings.mockResolvedValue([{ id: "meeting-1", transcript: "Example transcript" }]);
  process.env.TOME_AGENT_URL = "http://agent.example.test";
  process.env.TOME_SHAREPOINT_API_URL = "http://sharepoint.example.test";
  process.env.TOME_SHAREPOINT_API_TOKEN = "test-service-token";
  global.fetch = jest.fn(async () => new Response(JSON.stringify(document), { status: 200 }));
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries({ TOME_AGENT_URL: originalEnv.agent, TOME_SHAREPOINT_API_URL: originalEnv.sharepoint, TOME_SHAREPOINT_API_TOKEN: originalEnv.token })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function submit(body: Record<string, unknown>, synthesis = false) {
  return (synthesis ? synthesize : ingest)(new NextRequest(`http://example.test/api/tome/projects/example/${synthesis ? "synthesize" : "reingest"}`, {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ slug: "example" }) });
}

it.each(["project", "area", "bhag"])("validates per-run files through the configured app for %s without persisting sources", async (type) => {
  project.type = type;
  const response = await submit({ sharepointDocuments: [{ ...document, name: "Untrusted name", token: "not-forwarded" }] }, type !== "project");
  expect(response.status).toBe(200);
  expect(mockStart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sharepointDocuments: [document] }));
  expect(global.fetch).toHaveBeenCalledWith(new URL("http://sharepoint.example.test/documents/drive-1/context/metadata"), expect.objectContaining({ redirect: "error" }));
  expect(project.sources.sharepoint_documents).toEqual([saved]);
});
it("keeps one-off context on the cascade parent", async () => {
  project.type = "bhag";
  expect((await submit({ sharepointDocuments: [document], refreshChildren: true }, true)).status).toBe(200);
  expect(mockCascade).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sharepointDocuments: [document] }));
  expect(mockStart).not.toHaveBeenCalled();
});
it("can combine one-off documents and selected meetings", async () => {
  await submit({ sharepointDocuments: [document], webexMeetings: [{ id: "meeting-1", title: "Example", start: "2026-01-01" }] });
  expect(mockStart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sharepointDocuments: [document], webexMeetings: [{ id: "meeting-1", transcript: "Example transcript" }] }));
});
it.each([{ mode: "quick" }, { sourceScope: "webex_meetings", webexMeetings: [{ id: "meeting-1" }] }])("rejects context for isolated/quick actions before calling SharePoint (%j)", async (scope) => {
  await expect(submit({ ...scope, sharepointDocuments: [document] })).rejects.toMatchObject({ statusCode: 400 });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
});
it("rejects traversal and combined over-limit selections before provider calls", async () => {
  await expect(submit({ sharepointDocuments: [{ ...document, item_id: ".." }] })).rejects.toMatchObject({ statusCode: 400 });
  project.sources.sharepoint_documents = Array.from({ length: 10 }, (_, index) => ({ ...saved, item_id: `saved-${index}` }));
  await expect(submit({ sharepointDocuments: [document] })).rejects.toMatchObject({ statusCode: 400 });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
});
it("does not start a run when the document is no longer accessible", async () => {
  global.fetch = jest.fn(async () => new Response("private provider detail", { status: 404 }));
  await expect(submit({ sharepointDocuments: [document] })).rejects.toMatchObject({ statusCode: 404 });
  expect(mockStart).not.toHaveBeenCalled();
});
it("requires edit permission before accessing app-only files", async () => {
  mockRequireEditor.mockImplementation(() => { throw new ApiError("Denied", 403, "FORBIDDEN"); });
  await expect(submit({ sharepointDocuments: [document] })).rejects.toMatchObject({ statusCode: 403 });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
});
it("preserves existing ingest behavior with no per-run SharePoint payload", async () => {
  await submit({ seed: "Refresh" });
  expect(mockStart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sharepointDocuments: undefined }));
  expect(global.fetch).not.toHaveBeenCalled();
});
