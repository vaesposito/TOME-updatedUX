import { randomUUID } from "crypto";
import type { Filter } from "mongodb";

import { getTomeChatRunsCollection } from "@/lib/tome/mongo-collections";
import type {
  ChatRun,
  ChatRunEvent,
  ChatRunStatus,
  ChatSession,
} from "@/types/tome";

const RUN_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * The UI process consuming a run's upstream stream is the only thing that can
 * finish it, so it renews `heartbeat_at` on this cadence for as long as it
 * holds the stream — including silent stretches (project lock waits, slow
 * tools). The same write is how it learns the run was stopped elsewhere.
 */
export const CHAT_RUN_HEARTBEAT_MS = 5_000;

/** An active run whose heartbeat is older than this has lost its owner. */
export const CHAT_RUN_ORPHAN_MS = 30_000;

const ACTIVE_STATUSES: ChatRunStatus[] = ["starting", "running"];
const ORPHANED_RUN_ERROR =
  "This response stopped before it finished. Please send your message again.";
export const STOPPED_RUN_ERROR = "Stopped by user";

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + RUN_RETENTION_MS);
}

function failedFields(now: Date, error: string) {
  return {
    status: "failed" as const,
    error,
    updated_at: now,
    finished_at: now,
    expires_at: expiryFrom(now),
  };
}

export function isChatRunOrphaned(
  run: Pick<ChatRun, "status" | "updated_at" | "heartbeat_at">,
  now: Date = new Date(),
): boolean {
  const lastSeen = run.heartbeat_at ?? run.updated_at;
  return (
    ACTIVE_STATUSES.includes(run.status) &&
    now.getTime() - new Date(lastSeen).getTime() > CHAT_RUN_ORPHAN_MS
  );
}

/**
 * Fail active runs matching `filter` whose owner stopped heartbeating. The
 * cutoff is part of the update filter, so a run whose owner just renewed its
 * heartbeat is never failed out from under it.
 */
export async function failOrphanedChatRuns(
  filter: Filter<ChatRun>,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - CHAT_RUN_ORPHAN_MS);
  const runs = await getTomeChatRunsCollection();
  const result = await runs.updateMany(
    {
      ...filter,
      status: { $in: ACTIVE_STATUSES },
      $or: [
        { heartbeat_at: { $lt: cutoff } },
        { heartbeat_at: { $exists: false }, updated_at: { $lt: cutoff } },
      ],
    },
    { $set: failedFields(now, ORPHANED_RUN_ERROR) },
  );
  return result.modifiedCount;
}

/**
 * Renew the owner's heartbeat. Returns false once the run is no longer active
 * (stopped by the user, or failed as orphaned), telling the owner to abort its
 * upstream stream — which is what cancels the agent's turn.
 */
export async function heartbeatChatRun(runId: string): Promise<boolean> {
  const runs = await getTomeChatRunsCollection();
  const result = await runs.updateOne(
    { _id: runId, status: { $in: ACTIVE_STATUSES } },
    { $set: { heartbeat_at: new Date() } },
  );
  return result.matchedCount > 0;
}

/**
 * Keep `runId`'s heartbeat alive until the returned function is called, and
 * call `onInactive` (once) as soon as the run is found stopped. A failed
 * heartbeat write is logged and retried on the next tick rather than treated
 * as a stop.
 */
export function watchChatRun(runId: string, onInactive: () => void): () => void {
  let stopped = false;
  const tick = async () => {
    try {
      if (!(await heartbeatChatRun(runId)) && !stopped) {
        stopped = true;
        clearInterval(timer);
        onInactive();
      }
    } catch (error) {
      console.error(`Failed to heartbeat TOME chat run ${runId}`, error);
    }
  };
  const timer = setInterval(() => void tick(), CHAT_RUN_HEARTBEAT_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Stop the caller's own active run. Returns false if it was not active. */
export async function stopChatRun(
  runId: string,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const runs = await getTomeChatRunsCollection();
  const result = await runs.updateOne(
    {
      _id: runId,
      project_id: projectId,
      user_id: userId,
      status: { $in: ACTIVE_STATUSES },
    },
    { $set: failedFields(new Date(), STOPPED_RUN_ERROR) },
  );
  return result.modifiedCount > 0;
}

export async function createChatRun(session: ChatSession, myagent?: {
  subject: string; sources: string[]; revision: string; seed: string;
}): Promise<ChatRun> {
  const now = new Date();
  const run: ChatRun = {
    _id: randomUUID(),
    session_id: session._id!,
    project_id: session.project_id,
    user_id: session.user_id,
    status: "starting",
    ...(myagent ? {
      triggered_by_sub: myagent.subject,
      myagent_interactive_authorized: true,
      myagent_tool_enabled: true,
      myagent_consent_revision: myagent.revision,
      myagent_allowed_sources: myagent.sources,
      myagent_seed: myagent.seed,
    } : {}),
    events: [],
    last_event_id: 0,
    created_at: now,
    updated_at: now,
    heartbeat_at: now,
    expires_at: expiryFrom(now),
  };
  const runs = await getTomeChatRunsCollection();
  await runs.insertOne(run);
  return run;
}

export async function markChatRunRunning(runId: string): Promise<void> {
  const runs = await getTomeChatRunsCollection();
  await runs.updateOne(
    { _id: runId, status: "starting" },
    { $set: { status: "running", updated_at: new Date() } },
  );
}

export async function appendChatRunEvents(
  runId: string,
  events: ChatRunEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const runs = await getTomeChatRunsCollection();
  await runs.updateOne(
    { _id: runId, status: { $in: ["starting", "running"] } },
    {
      $push: { events: { $each: events } },
      $set: {
        last_event_id: events[events.length - 1].id,
        updated_at: new Date(),
      },
    },
  );
}

export async function finishChatRun(
  runId: string,
  status: Extract<ChatRunStatus, "completed" | "failed">,
  error?: string,
): Promise<void> {
  const now = new Date();
  const runs = await getTomeChatRunsCollection();
  // Only an active run can finish: a stopped or orphaned run must not flip
  // back to completed when its stream finally drains.
  await runs.updateOne(
    { _id: runId, status: { $in: ACTIVE_STATUSES } },
    {
      $set: {
        status,
        updated_at: now,
        finished_at: now,
        expires_at: expiryFrom(now),
        ...(error ? { error } : {}),
      },
    },
  );
}

export async function findActiveChatRun(
  projectId: string,
  userId: string,
): Promise<ChatRun | null> {
  // An orphaned run would otherwise be resumed on every load, pinning the
  // chat in a streaming state.
  await failOrphanedChatRuns({ project_id: projectId, user_id: userId });
  const runs = await getTomeChatRunsCollection();
  return runs.findOne(
    {
      project_id: projectId,
      user_id: userId,
      status: { $in: ACTIVE_STATUSES },
    },
    { sort: { created_at: -1 } },
  );
}

export async function loadOwnedChatRun(
  runId: string,
  projectId: string,
  userId: string,
): Promise<ChatRun | null> {
  const runs = await getTomeChatRunsCollection();
  return runs.findOne({ _id: runId, project_id: projectId, user_id: userId });
}
