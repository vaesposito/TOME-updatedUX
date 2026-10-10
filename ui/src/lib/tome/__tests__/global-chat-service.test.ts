/** @jest-environment node */

import { startTomeGlobalTurn, type TomeGlobalTurnInput } from "../global-chat-service";
import { narrowTomeRetrievalCatalog } from "../retrieval-scope";

const mockScope = jest.fn();
const mockSettings = jest.fn();
const mockFind = jest.fn();
const mockLease = jest.fn();
const mockUpdate = jest.fn();
const mockFetch = jest.fn();
let mockFrames: { event: string; data: string }[];

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class extends Error {
    constructor(message: string, public status: number, public code: string) { super(message); }
  },
}));
jest.mock("@/lib/mongodb", () => ({
  getCollection: async () => ({
    createIndex: jest.fn(), findOne: mockFind,
    findOneAndUpdate: mockLease, updateOne: mockUpdate,
  }),
}));
jest.mock("../access", () => ({}));
jest.mock("../retrieval-scope", () => ({
  ...jest.requireActual("../retrieval-scope"),
  buildTomeRetrievalScope: (...args: unknown[]) => mockScope(...args),
}));
jest.mock("../assistant-settings-store", () => ({
  readTomeAssistantSettings: () => mockSettings(),
}));
jest.mock("../agent-auth", () => ({ tomeAgentAuthorizationHeaders: () => ({}) }));
jest.mock("@/lib/streaming/parse-sse", () => ({
  parseSSEStream: async function* () { yield* mockFrames; },
}));

const catalog = [
  { project_id: "b", slug: "example-goal", name: "Goal", project_type: "bhag" as const, bhags: [], areas: [] },
  { project_id: "a", slug: "example-area", name: "Area", project_type: "area" as const, bhags: ["example-goal"], areas: [] },
  { project_id: "p", slug: "example-project", name: "Project", project_type: "project" as const, bhags: [], areas: ["example-area"] },
  { project_id: "s", slug: "secondary", name: "Secondary", project_type: "project" as const, bhags: [], areas: [] },
];
const input = (): TomeGlobalTurnInput => ({
  subject: "example-user", message: "Summarize the roadmap",
  session: { kind: "mcp", id: "00000000-0000-4000-8000-000000000001" },
  signal: new AbortController().signal,
});
const frame = (event: string, data: unknown) => ({ event, data: JSON.stringify(data) });
const originalFetch = global.fetch;
const originalUrl = process.env.TOME_AGENT_URL;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TOME_AGENT_URL = "https://example.test";
  global.fetch = mockFetch;
  mockSettings.mockResolvedValue({ tome_live_verification_mode: "off" });
  mockScope.mockResolvedValue({ catalog, hash: "authorized-scope" });
  mockFind.mockResolvedValue({ owner_subject: "example-user" });
  mockLease.mockResolvedValue({
    catalog_hash: "authorized-scope", expires_at: new Date(Date.now() + 60_000),
    retrieval_history: [{ role: "user", content: "Previous question" }, { role: "assistant", content: "Previous answer" }],
  });
  mockFetch.mockResolvedValue({ ok: true, body: {}, status: 200 });
  mockFrames = [
    frame("session", { retrieval_history: [{ role: "user", content: "New question" }] }),
    frame("done", { success: true }),
  ];
});
afterAll(() => {
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.TOME_AGENT_URL;
  else process.env.TOME_AGENT_URL = originalUrl;
});

describe("authorized retrieval scope", () => {
  it.each([
    ["bhag", "example-goal", ["b", "a", "p"]],
    ["area", "example-area", ["a", "p"]],
    ["project", "example-project", ["p"]],
  ] as const)("narrows %s scope to readable descendants", (type, slug, ids) => {
    expect(narrowTomeRetrievalCatalog(catalog, { type, slug }).map((entry) => entry.project_id)).toEqual(ids);
  });
  it("does not add inaccessible descendants", () => {
    expect(narrowTomeRetrievalCatalog(catalog.slice(0, 2), { type: "bhag", slug: "example-goal" })).toHaveLength(2);
  });
  it.each(["unavailable", "example-area"])("rejects unavailable or mismatched root %s", (slug) => {
    expect(() => narrowTomeRetrievalCatalog(catalog, { type: "project", slug })).toThrow("unavailable");
  });
});

describe("native global sessions", () => {
  it("requires an unexpired session owned by the caller", async () => {
    mockFind.mockResolvedValue(null);
    await expect(startTomeGlobalTurn(input())).rejects.toMatchObject({ code: "TOME_SESSION_UNAVAILABLE" });
    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({
      owner_subject: "example-user", expires_at: { $gt: expect.any(Date) },
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("rejects concurrent turns without reaching the model", async () => {
    mockLease.mockResolvedValue(null);
    await expect(startTomeGlobalTurn(input())).rejects.toMatchObject({ code: "TOME_CHAT_BUSY" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("reuses history only within the same current scope", async () => {
    const turn = await startTomeGlobalTurn(input());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.global_chat).toBe(true);
    expect(body.retrieval_history).toHaveLength(2);
    expect(body.sdk_session_id).toBeNull();
    expect(body.credentials).toEqual({});
    expect(body.actor_sub).toBe("example-user");
    const emitted = [];
    for await (const event of turn.events) emitted.push(event);
    expect(emitted.map((event) => event.event)).toEqual(["done"]);
  });
  it("rescoping clears retained history and narrows the actual corpus", async () => {
    const turn = await startTomeGlobalTurn({ ...input(), scope: { type: "project", slug: "example-project" } });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.retrieval_history).toEqual([]);
    expect(body.snapshot.readable_projects).toEqual([catalog[2]]);
    for await (const event of turn.events) expect(event.event).toBe("done");
  });
  it("invalidates history after permission changes", async () => {
    mockLease.mockResolvedValue({ catalog_hash: "old-scope", expires_at: new Date(Date.now() + 60_000) });
    const turn = await startTomeGlobalTurn(input());
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).retrieval_history).toEqual([]);
    for await (const event of turn.events) expect(event.event).toBe("done");
  });
  it("rejects permission changes before completion and releases the lease", async () => {
    const turn = await startTomeGlobalTurn(input());
    mockScope.mockResolvedValue({ catalog: [], hash: "changed-scope" });
    await expect((async () => { for await (const event of turn.events) void event; })()).rejects.toMatchObject({ code: "TOME_SCOPE_CHANGED" });
    expect(mockUpdate).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $set: expect.objectContaining({ retrieval_history: [{ role: "user", content: "New question" }] }),
    }));
    expect(mockUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ lease_id: expect.any(String) }), expect.objectContaining({ $unset: expect.objectContaining({ lease_until: "" }) }));
  });
  it("rejects live verification when the feature is disabled", async () => {
    await expect(startTomeGlobalTurn({ ...input(), verifySources: true })).rejects.toMatchObject({ code: "TOME_LIVE_VERIFICATION_DISABLED" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("does not reuse live assistant answers as evidence", async () => {
    mockSettings.mockResolvedValue({ tome_live_verification_mode: "on_demand" });
    mockFrames[1] = frame("done", { success: true, live_verification: { mode: "required", status: "completed" } });
    const turn = await startTomeGlobalTurn({ ...input(), verifySources: true });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.retrieval_history).toEqual([{ role: "user", content: "Previous question" }]);
    expect(body.live_verification).toBe("required");
    expect(body.live_verification_grant).toMatch(/^[0-9a-f]{64}$/);
    for await (const event of turn.events) expect(event.event).toBe("done");
  });
  it("requires the native runtime to report requested verification", async () => {
    mockSettings.mockResolvedValue({ tome_live_verification_mode: "on_demand" });
    const turn = await startTomeGlobalTurn({ ...input(), verifySources: true });
    await expect((async () => { for await (const event of turn.events) void event; })()).rejects.toMatchObject({ code: "TOME_LIVE_RUNTIME_REQUIRED" });
  });
});
