/** Shared native orchestration for browser chat and MCP delegation. */
import { createHash, randomUUID } from "crypto";

import { ApiError } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { parseSSEStream, type RawSSEEvent } from "@/lib/streaming/parse-sse";
import { tomeAgentAuthorizationHeaders } from "./agent-auth";
import type { AgentChatRequest } from "./agent-proxy";
import { buildTomeRetrievalScope, narrowTomeRetrievalCatalog, type TomeRetrievalRestriction } from "./retrieval-scope";

interface RetrievalMessage {
  role: "user" | "assistant";
  content: string;
}

interface NativeChatSession {
  _id: string;
  owner_subject?: string;
  retrieval_history?: RetrievalMessage[];
  catalog_hash?: string;
  lease_id?: string;
  lease_until?: Date;
  expires_at: Date;
}

export interface TomeGlobalTurnInput {
  // Callers supply only identities derived by their authenticated boundary.
  subject: string;
  email?: string | null;
  message: string;
  session: { kind: "grid"; id: string } | { kind: "mcp"; id?: string };
  scope?: TomeRetrievalRestriction;
  signal: AbortSignal;
}

function parseHistory(value: unknown): RetrievalMessage[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Invalid retrieval session state");
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid retrieval session message");
    const { role, content } = entry as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || content.length > 12_000) {
      throw new Error("Invalid retrieval session message");
    }
    return { role, content };
  });
}

export async function startTomeGlobalTurn(input: TomeGlobalTurnInput): Promise<{
  sessionId: string;
  events: AsyncGenerator<RawSSEEvent>;
  cancel: () => void;
}> {
  if (!input.subject || !input.message.trim() || input.message.length > 12_000) {
    throw new ApiError("A caller identity and question of at most 12000 characters are required", 400, "BAD_REQUEST");
  }
  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) throw new ApiError("TOME agent is not configured", 503, "AGENT_NOT_CONFIGURED");
  const authorized = await buildTomeRetrievalScope(input.subject);
  const catalog = narrowTomeRetrievalCatalog(authorized.catalog, input.scope);
  if (!catalog.length) throw new ApiError("No readable TOME entities", 403, "TOME_READ_REQUIRED");
  const scopeHash = input.scope
    ? createHash("sha256").update(JSON.stringify([authorized.hash, catalog.map((entry) => entry.project_id)])).digest("hex")
    : authorized.hash;
  const sessionId = input.session.id ?? randomUUID();
  const key = createHash("sha256").update(JSON.stringify(input.session.kind === "grid"
    ? [sessionId, input.subject] : ["mcp", sessionId])).digest("hex");
  const sessions = await getCollection<NativeChatSession>("tome_global_chat_sessions");
  await sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  if (input.session.kind === "mcp" && input.session.id) {
    const existing = await sessions.findOne({ _id: key, owner_subject: input.subject, expires_at: { $gt: new Date() } });
    if (!existing) throw new ApiError("TOME session is unavailable", 404, "TOME_SESSION_UNAVAILABLE");
  } else {
    await sessions.updateOne({ _id: key }, {
      $setOnInsert: { owner_subject: input.subject, expires_at: new Date(Date.now() + 7 * 86400_000) },
    }, { upsert: true });
  }
  const leaseId = randomUUID();
  const state = await sessions.findOneAndUpdate({
    _id: key,
    ...(input.session.kind === "mcp" ? { owner_subject: input.subject, expires_at: { $gt: new Date() } } : {}),
    $or: [{ lease_until: { $lte: new Date() } }, { lease_until: { $exists: false } }],
  }, { $set: { lease_id: leaseId, lease_until: new Date(Date.now() + 360_000), expires_at: new Date(Date.now() + 7 * 86400_000) } },
  { returnDocument: "before" });
  if (!state) throw new ApiError("TOME is already responding in this session", 409, "TOME_CHAT_BUSY");

  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  const timeout = setTimeout(abort, 290_000);
  const release = async () => {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", abort);
    await sessions.updateOne({ _id: key, lease_id: leaseId }, { $unset: { lease_id: "", lease_until: "" } });
  };
  let upstream: Response;
  try {
    const reuseHistory = state.catalog_hash === scopeHash && state.expires_at > new Date();
    if (!reuseHistory) await sessions.updateOne({ _id: key, lease_id: leaseId }, {
      $set: { retrieval_history: [], catalog_hash: scopeHash }, $unset: { sdk_session_id: "" },
    });
    const body: AgentChatRequest = {
      global_chat: true, message: input.message, role: "viewer", sdk_session_id: null,
      retrieval_scope_hash: authorized.hash,
      retrieval_history: reuseHistory ? parseHistory(state.retrieval_history ?? []) : [],
      actor_sub: input.subject, actor_email: input.email ?? null, credentials: {}, stable_pages: {},
      issue_context: { decisions: [], critical: [], decision_count: 0, critical_count: 0, decision_truncated: false, critical_truncated: false },
      snapshot: {
        project_id: `global-chat-${key}`, slug: "", name: "TOME", charter: "", phase: null, cadence: null,
        project_type: "project", repos: [], webex_rooms: [], confluence_spaces: [], child_projects: [], readable_projects: catalog,
      },
    };
    upstream = await fetch(`${agentUrl.replace(/\/$/, "")}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json", ...tomeAgentAuthorizationHeaders() },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) throw new ApiError(`TOME agent returned HTTP ${upstream.status}`, 502, "TOME_AGENT_ERROR");
  } catch (error) {
    controller.abort();
    await release();
    throw error;
  }

  async function* events(): AsyncGenerator<RawSSEEvent> {
    let history: RetrievalMessage[] | null = null;
    let completed = false;
    let reportedError = false;
    try {
      for await (const frame of parseSSEStream(upstream)) {
        if (completed) throw new Error("Unexpected event after TOME completion");
        if (Buffer.byteLength(frame.data, "utf8") > 1_000_000) throw new Error("TOME event exceeds its limit");
        const data = JSON.parse(frame.data) as Record<string, unknown>;
        if (frame.event === "session") {
          history = parseHistory(data.retrieval_history);
          continue; // Retained model context is never a client payload.
        }
        if (frame.event === "error") reportedError = true;
        if (frame.event === "done") {
          if (data.success !== true || !history || reportedError) throw new Error("TOME did not complete successfully");
          if ((await buildTomeRetrievalScope(input.subject)).hash !== authorized.hash) {
            throw new ApiError("TOME access changed during this turn", 409, "TOME_SCOPE_CHANGED");
          }
          // Save model history only after a successful, currently authorized turn.
          await sessions.updateOne({ _id: key, lease_id: leaseId }, {
            $set: { retrieval_history: history, catalog_hash: scopeHash }, $unset: { sdk_session_id: "" },
          });
          completed = true;
        }
        yield frame;
      }
      if (!completed && !reportedError) throw new Error("TOME stream ended before completion");
    } finally {
      controller.abort();
      await release();
    }
  }
  return { sessionId, events: events(), cancel: abort };
}
