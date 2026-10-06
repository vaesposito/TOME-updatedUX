/** @jest-environment node */
import type { ProjectDocument } from "@/types/projects";
import type { IngestRun } from "@/types/tome";
import type { TomeProjectContext } from "../tome-api";

const mockInsertRun = jest.fn();
const mockUpdateRun = jest.fn();
const mockBuildRequest = jest.fn();
const mockChildren = jest.fn();
const mockResolveSharePointDocuments = jest.fn();
const runRecords = new Map<string, IngestRun>();
const projectRecords = new Map<string, ProjectDocument & { _id: string }>();

jest.mock("@/lib/mongodb", () => ({ getCollection: async () => ({
  findOne: async ({ _id }: { _id: string }) => projectRecords.get(_id), updateOne: jest.fn(),
}) }));
jest.mock("../mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({
    findOne: async ({ _id }: { _id?: string }) => _id ? runRecords.get(_id) : null,
    insertOne: mockInsertRun, updateOne: mockUpdateRun,
  }),
  getTomeReportsCollection: async () => ({
    find: () => ({ sort: () => ({ limit: () => ({ next: async () => ({ version: 1 }) }) }) }), insertOne: jest.fn(),
  }),
}));
jest.mock("../agent-proxy", () => ({
  sessionSub: () => "test-user", resolveProjectCredentials: async () => ({}),
  buildIngestRequest: (...args: unknown[]) => mockBuildRequest(...args),
}));
jest.mock("../github-source-reconciliation", () => ({ reconcileGitHubSourcesForIngest: async (project: unknown) => ({ project, canonicalized: [], tombstonedPaths: [] }) }));
jest.mock("../github-issue-scope", () => ({ selectTomeRollupProjects: () => [], rollupGitHubRepos: () => [] }));
jest.mock("../github-issue-cache", () => ({ loadTomeIssueCache: jest.fn(), buildTomeIssueContext: async () => ({}) }));
jest.mock("../page-store", () => ({}));
jest.mock("../sharepoint", () => ({ resolveSharePointDocuments: (...args: unknown[]) => mockResolveSharePointDocuments(...args) }));
jest.mock("../page-templates-store", () => ({}));
jest.mock("../audit", () => ({ auditTome: jest.fn() }));
jest.mock("../mycelium", () => ({ isMyceliumConfigured: () => false }));
jest.mock("../access", () => ({ isTomeAdminSubject: async () => false, listReadableTomeProjects: async () => [] }));
jest.mock("../evaluation-store", () => ({ resolveQualityPolicy: async () => ({ policy: { mode: "off", version: 1 } }) }));
jest.mock("../rubric-evaluator", () => ({}));
jest.mock("../evidence-bundle", () => ({}));
jest.mock("../draft-quality", () => ({}));
jest.mock("../bhag", () => ({ resolveBhagChildren: (...args: unknown[]) => mockChildren(...args), resolveAreaChildren: async () => [] }));

import { dispatchQueuedRun, enqueueBhagCascade, enqueueRun } from "../ingest-runner";

const contextDocument = { drive_id: "drive-1", item_id: "context", name: "Context.pptx" };
function project(id: string, type = "project") {
  return { _id: id, slug: id, name: id, type, sources: {
    sharepoint_documents: [{ drive_id: "drive-1", item_id: "saved", name: "Saved.pdf" }],
  } } as ProjectDocument & { _id: string };
}
beforeEach(() => {
  jest.clearAllMocks();
  runRecords.clear();
  projectRecords.clear();
  mockInsertRun.mockImplementation(async (run: IngestRun) => { runRecords.set(run._id!, run); });
  mockChildren.mockResolvedValue([]);
  mockResolveSharePointDocuments.mockResolvedValue([contextDocument]);
});

it("persists one-off IDs on a queued run and forwards them during deferred preparation", async () => {
  const sourceProject = project("example-project");
  projectRecords.set(sourceProject._id, sourceProject);
  const runId = await enqueueRun(sourceProject, { sub: "test-user", dispatch: {
    endpoint: "/ingest", sharepointDocuments: [contextDocument],
  } });
  expect(runRecords.get(runId)?.dispatch?.sharepointDocuments).toEqual([contextDocument]);
  const captured = new Promise<Record<string, unknown>>((resolve) => {
    mockBuildRequest.mockImplementation((_project, options: Record<string, unknown>) => {
      resolve(options);
      // Stop before the external agent stream; this test covers queue preparation.
      throw new Error("Test preparation complete");
    });
  });
  dispatchQueuedRun(runId);
  expect((await captured).sharepointDocuments).toEqual([contextDocument]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(sourceProject.sources!.sharepoint_documents).toEqual([{ drive_id: "drive-1", item_id: "saved", name: "Saved.pdf" }]);
});

it("attaches cascade context to the parent, not any child run", async () => {
  const parent = project("example-parent", "bhag");
  const child = project("example-child");
  projectRecords.set(child._id, child);
  mockChildren.mockResolvedValue([{ project_id: child._id, slug: child.slug, type: "project" }]);
  const result = await enqueueBhagCascade({ project: parent, session: { sub: "test-user" }, user: { email: "test-user@example.test" } } as unknown as TomeProjectContext,
    { sharepointDocuments: [contextDocument] });
  expect(runRecords.get(result.parentRunId)?.dispatch?.sharepointDocuments).toEqual([contextDocument]);
  const children = [...runRecords.values()].filter((run) => run.cascade_role === "child");
  expect(children).toHaveLength(1);
  expect(children[0].dispatch).not.toHaveProperty("sharepointDocuments");
});

it("never copies per-run context into a later unattended run", async () => {
  const sourceProject = project("example-project");
  await enqueueRun(sourceProject, { sub: "test-user", dispatch: { endpoint: "/ingest", sharepointDocuments: [contextDocument] } });
  const autoId = await enqueueRun(sourceProject, { sub: "test-user", triggeredBy: "auto", dispatch: { endpoint: "/ingest" } });
  expect(runRecords.get(autoId)?.dispatch).not.toHaveProperty("sharepointDocuments");
});

it.each(["manual", "auto"] as const)("resolves a folder during %s run preparation without changing project sources", async (triggeredBy) => {
  const sourceProject = project("example-folder-project");
  const folder = { kind: "folder" as const, drive_id: "drive-1", item_id: "folder-1", name: "Example folder" };
  sourceProject.sources!.sharepoint_documents = [folder];
  projectRecords.set(sourceProject._id, sourceProject);
  const runId = await enqueueRun(sourceProject, { sub: "test-user", triggeredBy, dispatch: { endpoint: "/ingest" } });
  const captured = new Promise<Record<string, unknown>>((resolve) => {
    mockBuildRequest.mockImplementation((_project, options: Record<string, unknown>) => { resolve(options); throw new Error("Test preparation complete"); });
  });
  dispatchQueuedRun(runId);
  expect((await captured).resolvedSharepointDocuments).toEqual([contextDocument]);
  expect(mockResolveSharePointDocuments).toHaveBeenCalledWith([folder], undefined);
  expect(sourceProject.sources!.sharepoint_documents).toEqual([folder]);
  await new Promise((resolve) => setImmediate(resolve));
});

it("does not enumerate folders for a quick edit", async () => {
  const sourceProject = project("example-quick-project");
  sourceProject.sources!.sharepoint_documents = [{ kind: "folder", drive_id: "drive-1", item_id: "folder-1", name: "Example folder" }];
  projectRecords.set(sourceProject._id, sourceProject);
  const runId = await enqueueRun(sourceProject, { sub: "test-user", dispatch: { endpoint: "/ingest", mode: "quick" } });
  const captured = new Promise<Record<string, unknown>>((resolve) => {
    mockBuildRequest.mockImplementation((_project, options: Record<string, unknown>) => { resolve(options); throw new Error("Test preparation complete"); });
  });
  dispatchQueuedRun(runId);
  expect((await captured).resolvedSharepointDocuments).toEqual([]);
  expect(mockResolveSharePointDocuments).not.toHaveBeenCalled();
  await new Promise((resolve) => setImmediate(resolve));
});
