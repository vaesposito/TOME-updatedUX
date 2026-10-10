/** @jest-environment node */

import { dispatchQueuedRun } from "../ingest-runner";
import { formatIngestEvent, type IngestEvent } from "../ingest-format";
import { auditTome } from "../audit";

const mockFindRun = jest.fn();
const mockUpdateRun = jest.fn();
const mockUpdateProject = jest.fn();
const mockUpdateReport = jest.fn();
const mockListPages = jest.fn();
const mockListDraftPaths = jest.fn();
const mockProject = {
  _id: "project-example", slug: "example-project", name: "Example", sources: {},
};

jest.mock("@/lib/mongodb", () => ({
  getCollection: async () => ({ findOne: async () => mockProject, updateOne: mockUpdateProject }),
}));
jest.mock("../mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({ findOne: mockFindRun, updateOne: mockUpdateRun }),
  getTomeReportsCollection: async () => ({ updateOne: mockUpdateReport }),
}));
jest.mock("../page-store", () => ({
  getPageStore: async () => ({ listPages: mockListPages, listDraftPaths: mockListDraftPaths }),
}));
jest.mock("../audit", () => ({ auditTome: jest.fn() }));
jest.mock("../mycelium", () => ({ isMyceliumConfigured: () => false }));
jest.mock("../agent-auth", () => ({ tomeAgentAuthorizationHeaders: () => ({}) }));
jest.mock("../agent-proxy", () => ({
  resolveProjectCredentials: async () => ({}), buildIngestRequest: () => ({}),
}));
jest.mock("../github-source-reconciliation", () => ({}));
jest.mock("../github-issue-scope", () => ({}));
jest.mock("../github-issue-cache", () => ({}));
jest.mock("../page-templates-store", () => ({}));
jest.mock("../access", () => ({}));
jest.mock("../evaluation-store", () => ({}));
jest.mock("../rubric-evaluator", () => ({}));
jest.mock("../evidence-bundle", () => ({}));
jest.mock("../draft-quality", () => ({}));
jest.mock("../bhag", () => ({}));

const originalFetch = global.fetch;
const originalAgentUrl = process.env.TOME_AGENT_URL;

afterAll(() => {
  global.fetch = originalFetch;
  if (originalAgentUrl === undefined) delete process.env.TOME_AGENT_URL;
  else process.env.TOME_AGENT_URL = originalAgentUrl;
});

async function runStream(events: IngestEvent[]): Promise<Record<string, unknown>> {
  const run: Record<string, unknown> = {
    _id: "run-example", project_id: "project-example", report_id: "report-example",
    status: "running", greenfield: false, quality_policy_mode: "off",
    dispatch: {
      endpoint: "/ingest", sourceScope: "webex_meetings",
      webexMeetings: [{ id: "meeting-example", title: "Example meeting" }],
    },
  };
  mockFindRun.mockImplementation(async () => run);
  mockUpdateRun.mockImplementation(async (_filter, update) => {
    Object.assign(run, update.$set ?? {});
    return { matchedCount: 1, modifiedCount: 1 };
  });
  const unlocked = new Promise<void>((resolve) => {
    mockUpdateProject.mockImplementation(async (_filter, update) => {
      if (update.$set.locked === false) resolve();
    });
  });
  const bytes = new TextEncoder().encode(events.map((event) =>
    `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
  ).join(""));
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
  });
  dispatchQueuedRun("run-example");
  await unlocked;
  return run;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TOME_AGENT_URL = "http://agent.example.test";
  mockListPages.mockResolvedValue([]);
  mockListDraftPaths.mockResolvedValue([]);
});

describe("ingest stream completion", () => {
  it("marks the run failed on a startup SSE error and never finalizes a report", async () => {
    const run = await runStream([{ type: "error", data: { message: "CLIConnectionError: Argument list too long" } }]);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Argument list too long");
    expect(run.finished_at).toBeInstanceOf(Date);
    expect(mockListPages).not.toHaveBeenCalled();
    expect(mockUpdateReport).not.toHaveBeenCalled();
    expect(auditTome).toHaveBeenCalledWith(expect.objectContaining({ action: "tome.ingest.failed", outcome: "error" }));
    expect(auditTome).not.toHaveBeenCalledWith(expect.objectContaining({ action: "tome.ingest.finished" }));
  });

  it.each([
    { events: [] as IngestEvent[] },
    { events: [{ type: "log", data: { line: "starting" } }] as IngestEvent[] },
  ])(
    "fails a closed stream without a completion result (%j)", async ({ events }) => {
      const run = await runStream(events);
      expect(run.status).toBe("failed");
      expect(run.error).toContain("without a successful completion result");
      expect(mockUpdateReport).not.toHaveBeenCalled();
    },
  );

  it.each([
    { subtype: "error_max_turns", is_error: false },
    { subtype: "success", is_error: true },
  ])("fails SDK terminal error %j and retains accounting", async (data) => {
    const run = await runStream([{ type: "done", data: { ...data, cost_usd: 0.12, turns: 2 } }]);
    expect(run.status).toBe("failed");
    expect(run.cost_usd).toBe(0.12);
    expect(run.turns).toBe(2);
    expect(formatIngestEvent({ type: "done", data })).toContain("✗ agent finished");
    expect(mockUpdateReport).not.toHaveBeenCalled();
  });

  it("does not let an earlier successful pass hide a later failure", async () => {
    const run = await runStream([
      { type: "done", data: { subtype: "success" } },
      { type: "error", data: { message: "Second pass failed" } },
    ]);
    expect(run.status).toBe("failed");
    expect(run.error).toBe("Second pass failed");
  });

  it("still finalizes a successful result from agents without the new is_error field", async () => {
    const run = await runStream([{ type: "done", data: { subtype: "success", cost_usd: 0.1 } }]);
    expect(run.status).toBe("succeeded");
    expect(mockUpdateReport).toHaveBeenCalled();
    expect(auditTome).toHaveBeenCalledWith(expect.objectContaining({ action: "tome.ingest.finished" }));
  });
});
