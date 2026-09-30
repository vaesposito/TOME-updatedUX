/** @jest-environment node */

const mockInsertEvidenceBundle = jest.fn();
const mockGetFetchLedgerEntries = jest.fn();

jest.mock("@/lib/tome/agent-proxy", () => ({
  buildSnapshotFromProject: jest.fn(() => ({ project_id: "project-id" })),
}));
jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: jest.fn(async () => ({
    listPages: jest.fn(async () => ({ "repos/example/overview.md": "# Overview" })),
  })),
}));
jest.mock("@/lib/tome/page-templates-store", () => ({
  getAllPageTemplates: jest.fn(async () => []),
}));
jest.mock("@/lib/tome/fetch-ledger-store", () => ({
  getFetchLedgerEntries: (...args: unknown[]) => mockGetFetchLedgerEntries(...args),
}));
jest.mock("../evaluation-store", () => {
  const actual = jest.requireActual("../evaluation-store");
  return {
    ...actual,
    insertEvidenceBundle: (...args: unknown[]) => mockInsertEvidenceBundle(...args),
  };
});

import { captureEvidenceBundle } from "../evidence-bundle";
import type { ProjectDocument } from "@/types/projects";
import type { FetchLedgerEntry } from "@/types/tome-evaluation";

const project = {
  _id: "project-id",
  slug: "example-project",
  name: "Example project",
  title: "Example project",
  description: "",
  team_id: "example-team",
  team_slug: "example-team",
  team_name: "Example Team",
  owner_id: "owner@example.test",
  member_ids: [],
  domain: "example",
  labels: {},
  tags: [],
  status: "active",
  catalog: {},
  components: [],
  onboarding: {},
  integrations: {},
  sources: {},
  source: "manual",
  created_at: new Date(0),
  updated_at: new Date(0),
} as ProjectDocument & { _id: string };

function fetchEntry(overrides: Partial<FetchLedgerEntry> = {}): FetchLedgerEntry {
  return {
    id: "entry-1",
    run_id: "run-1",
    project_id: "project-id",
    connector: "github",
    tool_name: "github_get_issue",
    tool_args: { repo: "org/repo", number: 42 },
    canonical_uri: "github://org/repo/issues/42",
    status: "success",
    content: "issue body",
    content_hash: "hash",
    error_message: null,
    timestamp: "2026-09-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("Evidence bundle source_fetch kind", () => {
  beforeEach(() => jest.clearAllMocks());

  it("omits source_fetch entirely, unchanged, when no runId is passed (FR-009)", async () => {
    mockGetFetchLedgerEntries.mockResolvedValue([fetchEntry()]);

    const bundle = await captureEvidenceBundle({ project, createdBy: "owner-subject" });

    expect(mockGetFetchLedgerEntries).not.toHaveBeenCalled();
    expect(bundle.items.some((item) => item.kind === "source_fetch")).toBe(false);
    // Existing kinds are present and unaffected by this feature's addition.
    expect(bundle.items.some((item) => item.kind === "project_snapshot")).toBe(true);
    expect(bundle.items.some((item) => item.kind === "github")).toBe(true);
  });

  it("includes one source_fetch item per successful entry when runId is passed", async () => {
    mockGetFetchLedgerEntries.mockResolvedValue([
      fetchEntry({ id: "a", canonical_uri: "github://org/repo/issues/1", content: "issue 1" }),
      fetchEntry({ id: "b", canonical_uri: "github://org/repo/issues/2", content: "issue 2" }),
    ]);

    const bundle = await captureEvidenceBundle({ project, createdBy: "owner-subject", runId: "run-1" });

    expect(mockGetFetchLedgerEntries).toHaveBeenCalledWith("run-1");
    const sourceFetchItems = bundle.items.filter((item) => item.kind === "source_fetch");
    expect(sourceFetchItems).toHaveLength(2);
    expect(sourceFetchItems.map((item) => item.canonical_uri).sort()).toEqual([
      "github://org/repo/issues/1",
      "github://org/repo/issues/2",
    ]);
  });

  it("excludes failed fetches from the evidence bundle", async () => {
    mockGetFetchLedgerEntries.mockResolvedValue([
      fetchEntry({ id: "ok", status: "success", content: "fine" }),
      fetchEntry({ id: "bad", status: "error", content: null, content_hash: null, error_message: "HTTP 404" }),
    ]);

    const bundle = await captureEvidenceBundle({ project, createdBy: "owner-subject", runId: "run-1" });

    const sourceFetchItems = bundle.items.filter((item) => item.kind === "source_fetch");
    expect(sourceFetchItems).toHaveLength(1);
    expect(sourceFetchItems[0].content).toBe("fine");
  });
});
