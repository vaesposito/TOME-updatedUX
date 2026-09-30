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
 * An active run with no new event for this long has lost the process that was
 * consuming its upstream stream (e.g. the UI pod was replaced mid-turn), and
 * nothing else will ever finish it. The agent's chat stream has no heartbeat
 * and can legitimately sit quiet on the project lock or a slow tool, so this
 * stays well above normal gaps between events.
 */
export const CHAT_RUN_STALE_MS = 15 * 60 * 1000;

const ACTIVE_STATUSES: ChatRunStatus[] = ["starting", "running"];
const STALE_RUN_ERROR =
  "This response stopped before it finished. Please send your message again.";

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + RUN_RETENTION_MS);
}

export function isChatRunStale(
  run: Pick<ChatRun, "status" | "updated_at">,
  now: Date = new Date(),
): boolean {
  return (
    ACTIVE_STATUSES.includes(run.status) &&
    now.getTime() - new Date(run.updated_at).getTime() > CHAT_RUN_STALE_MS
  );
}

/**
 * Fail active runs matching `filter` that have gone stale. The stale condition
 * is part of the update filter, so a run that just received an event is never
 * failed out from under its live consumer.
 */
export async function failStaleChatRuns(
  filter: Filter<ChatRun>,
  now: Date = new Date(),
): Promise<number> {
  const runs = await getTomeChatRunsCollection();
  const result = await runs.updateMany(
    {
      ...filter,
      status: { $in: ACTIVE_STATUSES },
      updated_at: { $lt: new Date(now.getTime() - CHAT_RUN_STALE_MS) },
    },
    {
      $set: {
        status: "failed",
        error: STALE_RUN_ERROR,
        updated_at: now,
        finished_at: now,
        expires_at: expiryFrom(now),
      },
    },
  );
  return result.modifiedCount;
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
  await runs.updateOne(
    { _id: runId },
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
  // chat in a streaming state with every control disabled.
  await failStaleChatRuns({ project_id: projectId, user_id: userId });
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
