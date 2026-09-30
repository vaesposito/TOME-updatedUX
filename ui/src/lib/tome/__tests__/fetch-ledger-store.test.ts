/** @jest-environment node */

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

import {
  getFetchLedgerEntries,
  getRunLedgerSummary,
  insertFetchLedgerEntry,
  TOME_FETCH_LEDGER_ENTRIES_COLLECTION,
  TOME_FETCH_LEDGER_RUN_SUMMARIES_COLLECTION,
} from "@/lib/tome/fetch-ledger-store";

describe("fetch-ledger-store", () => {
  let entryDocs: Array<Record<string, unknown>>;
  let summaryDocs: Array<Record<string, unknown>>;
  let entriesCollection: {
    createIndex: jest.Mock;
    insertOne: jest.Mock;
    find: jest.Mock;
  };
  let summariesCollection: {
    createIndex: jest.Mock;
    updateOne: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    entryDocs = [];
    summaryDocs = [];

    entriesCollection = {
      createIndex: jest.fn().mockResolvedValue(undefined),
      insertOne: jest.fn(async (doc: Record<string, unknown>) => {
        entryDocs.push(doc);
      }),
      find: jest.fn((filter: Record<string, unknown>) => ({
        sort: () => ({
          toArray: async () =>
            entryDocs.filter((doc) => doc.run_id === filter.run_id),
        }),
      })),
    };

    summariesCollection = {
      createIndex: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn(
        async (
          filter: { run_id: string },
          update: {
            $setOnInsert?: Record<string, unknown>;
            $inc?: Record<string, number>;
            $set?: Record<string, unknown>;
          },
        ) => {
          let doc = summaryDocs.find((d) => d.run_id === filter.run_id);
          if (!doc) {
            doc = { run_id: filter.run_id, fetch_count: 0, success_count: 0, total_bytes_fetched: 0 };
            Object.assign(doc, update.$setOnInsert);
            summaryDocs.push(doc);
          }
          for (const [key, value] of Object.entries(update.$inc ?? {})) {
            doc[key] = ((doc[key] as number) ?? 0) + value;
          }
          Object.assign(doc, update.$set);
        },
      ),
      findOne: jest.fn(async (filter: { run_id: string }) =>
        summaryDocs.find((d) => d.run_id === filter.run_id) ?? null,
      ),
    };

    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === TOME_FETCH_LEDGER_ENTRIES_COLLECTION) return entriesCollection;
      if (name === TOME_FETCH_LEDGER_RUN_SUMMARIES_COLLECTION) return summariesCollection;
      throw new Error(`unexpected collection ${name}`);
    });
  });

  it("inserts an entry and increments the run summary on success", async () => {
    await insertFetchLedgerEntry({
      run_id: "run-1",
      project_id: "project-1",
      connector: "github",
      tool_name: "github_get_issue",
      tool_args: { repo: "org/repo", number: 1 },
      canonical_uri: "github://org/repo/issues/1",
      status: "success",
      content: "hello",
      content_hash: "hash1",
      error_message: null,
    });

    expect(entryDocs).toHaveLength(1);
    const summary = await getRunLedgerSummary("run-1");
    expect(summary).toMatchObject({
      run_id: "run-1",
      project_id: "project-1",
      fetch_count: 1,
      success_count: 1,
      total_bytes_fetched: Buffer.byteLength("hello", "utf8"),
    });
  });

  it("increments fetch_count but not success_count/bytes on a failed fetch", async () => {
    await insertFetchLedgerEntry({
      run_id: "run-2",
      project_id: "project-1",
      connector: "github",
      tool_name: "github_get_issue",
      tool_args: {},
      canonical_uri: "github://org/repo/issues/2",
      status: "error",
      content: null,
      content_hash: null,
      error_message: "HTTP 404",
    });

    const summary = await getRunLedgerSummary("run-2");
    expect(summary).toMatchObject({ fetch_count: 1, success_count: 0, total_bytes_fetched: 0 });
  });

  it("accumulates across multiple entries in the same run", async () => {
    for (let i = 0; i < 3; i += 1) {
      await insertFetchLedgerEntry({
        run_id: "run-3",
        project_id: "project-1",
        connector: "github",
        tool_name: "github_get_issue",
        tool_args: {},
        canonical_uri: `github://org/repo/issues/${i}`,
        status: "success",
        content: "abc",
        content_hash: `hash-${i}`,
        error_message: null,
      });
    }

    const summary = await getRunLedgerSummary("run-3");
    expect(summary?.fetch_count).toBe(3);
    expect(summary?.success_count).toBe(3);
    expect(summary?.total_bytes_fetched).toBe(9);

    const entries = await getFetchLedgerEntries("run-3");
    expect(entries).toHaveLength(3);
  });

  it("returns null for a run with no summary yet", async () => {
    expect(await getRunLedgerSummary("no-such-run")).toBeNull();
  });
});
