/**
 * Mongo persistence for the source-fetch provenance ledger.
 *
 * See docs/docs/specs/2026-09-28-tome-source-fetch-ledger/. Two collections,
 * kept separate deliberately: entries can carry large raw fetched content,
 * while the per-run summary (fetch_count/total_bytes_fetched) is a small
 * document updated incrementally so reading it never requires scanning
 * entries (FR-013/SC-006).
 */

import { randomUUID } from "node:crypto";

import { getCollection } from "@/lib/mongodb";
import type { FetchLedgerEntry, RunLedgerSummary } from "@/types/tome-evaluation";

export const TOME_FETCH_LEDGER_ENTRIES_COLLECTION = "tome_fetch_ledger_entries";
export const TOME_FETCH_LEDGER_RUN_SUMMARIES_COLLECTION = "tome_fetch_ledger_run_summaries";

const DEFAULT_RETENTION_DAYS = 180;

/** Same TTL for both collections — a summary outliving its entries (or vice
 * versa) would be a confusing partial-retention state. */
function retentionSeconds(): number {
  const raw = process.env.TOME_FETCH_LEDGER_RETENTION_DAYS?.trim();
  const days = raw ? Number(raw) : NaN;
  const safeDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
  return Math.round(safeDays * 24 * 60 * 60);
}

// Mongo TTL indexes require a BSON Date field, so the stored document shape
// differs from the wire type (`timestamp`/`updated_at` are ISO strings on
// FetchLedgerEntry/RunLedgerSummary) — converted at the read/write boundary
// below, the same way `auth-refresh-state.ts` stores `expiresAt` as Date.
interface FetchLedgerEntryDoc extends Omit<FetchLedgerEntry, "timestamp"> {
  _id: string;
  timestamp: Date;
}

interface RunLedgerSummaryDoc extends Omit<RunLedgerSummary, "updated_at"> {
  _id: string;
  updated_at: Date;
}

let indexesReady: Promise<unknown> | null = null;

async function collections() {
  const entries = await getCollection<FetchLedgerEntryDoc>(TOME_FETCH_LEDGER_ENTRIES_COLLECTION);
  const summaries = await getCollection<RunLedgerSummaryDoc>(TOME_FETCH_LEDGER_RUN_SUMMARIES_COLLECTION);
  indexesReady ??= Promise.all([
    entries.createIndex({ run_id: 1 }),
    entries.createIndex({ project_id: 1, run_id: 1 }),
    entries.createIndex({ timestamp: 1 }, { expireAfterSeconds: retentionSeconds() }),
    summaries.createIndex({ run_id: 1 }, { unique: true }),
    summaries.createIndex({ project_id: 1 }),
    summaries.createIndex({ updated_at: 1 }, { expireAfterSeconds: retentionSeconds() }),
  ]);
  await indexesReady;
  return { entries, summaries };
}

function toFetchLedgerEntry(doc: FetchLedgerEntryDoc): FetchLedgerEntry {
  const { _id: _drop, timestamp, ...rest } = doc;
  void _drop;
  return { ...rest, timestamp: timestamp.toISOString() };
}

function toRunLedgerSummary(doc: RunLedgerSummaryDoc): RunLedgerSummary {
  const { _id: _drop, updated_at, ...rest } = doc;
  void _drop;
  return { ...rest, updated_at: updated_at.toISOString() };
}

/**
 * Persist one fetch-ledger entry and atomically roll it into that run's
 * summary. Both writes happen for every entry — see contracts/
 * internal-fetch-ledger-callback.md for why this isn't split into a
 * separate reconciliation step.
 */
export async function insertFetchLedgerEntry(
  input: Omit<FetchLedgerEntry, "id" | "timestamp"> & { timestamp?: string },
): Promise<FetchLedgerEntry> {
  const { entries, summaries } = await collections();
  const timestamp = input.timestamp ? new Date(input.timestamp) : new Date();
  const id = randomUUID();
  const doc: FetchLedgerEntryDoc = {
    _id: id,
    id,
    ...input,
    timestamp,
  };
  await entries.insertOne(doc);
  await summaries.updateOne(
    { run_id: input.run_id },
    {
      $setOnInsert: { project_id: input.project_id },
      $inc: {
        fetch_count: 1,
        ...(input.status === "success"
          ? { success_count: 1, total_bytes_fetched: Buffer.byteLength(input.content ?? "", "utf8") }
          : {}),
      },
      $set: { updated_at: timestamp },
    },
    { upsert: true },
  );
  return toFetchLedgerEntry(doc);
}

/** All entries for a run, oldest first — both successes and failures. */
export async function getFetchLedgerEntries(runId: string): Promise<FetchLedgerEntry[]> {
  const { entries } = await collections();
  const docs = await entries.find({ run_id: runId }).sort({ timestamp: 1 }).toArray();
  return docs.map(toFetchLedgerEntry);
}

export async function getRunLedgerSummary(runId: string): Promise<RunLedgerSummary | null> {
  const { summaries } = await collections();
  const doc = await summaries.findOne({ run_id: runId });
  return doc ? toRunLedgerSummary(doc) : null;
}
