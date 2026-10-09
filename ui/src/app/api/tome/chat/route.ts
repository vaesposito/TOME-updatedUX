/** Global native TOME chat, with GRID conversation authorization and persistence. */
import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { trustedInteractionFromRequest } from "@/lib/authz/trusted-interaction";
import { authenticateRequest } from "@/lib/da-proxy";
import { getCollection } from "@/lib/mongodb";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";
import { parseSSEStream } from "@/lib/streaming/parse-sse";
import { isTomeAdminSubject, listReadableTomeProjects } from "@/lib/tome/access";
import { tomeAgentAuthorizationHeaders } from "@/lib/tome/agent-auth";
import type { AgentChatRequest, ChildProjectSnapshot } from "@/lib/tome/agent-proxy";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { getAgentId } from "@/types/a2a";
import type { Conversation } from "@/types/mongodb";
import { requireConversationWriteAccess } from "../../v1/chat/_conversation-authz";

export const runtime = "nodejs";
export const maxDuration = 300;

interface NativeChatSession {
  _id: string;
  sdk_session_id?: string;
  catalog_hash?: string;
  lease_id?: string | null;
  lease_until?: Date;
  expires_at: Date;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isTomeServerEnabled()) throw new ApiError("Not found", 404, "NOT_FOUND");
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.isServiceAccount || !auth.subject) {
    throw new ApiError("Interactive user identity required", 403, "TOME_USER_REQUIRED");
  }
  const input = await request.json() as { message?: unknown; conversation_id?: unknown };
  if (typeof input.message !== "string" || !input.message.trim() || input.message.length > 100_000 ||
      typeof input.conversation_id !== "string" || input.conversation_id.length > 128) {
    throw new ApiError("A message and conversation_id are required", 400, "BAD_REQUEST");
  }
  const denied = await requireConversationWriteAccess(auth, input.conversation_id);
  if (denied) return denied;
  const conversations = await getCollection<Conversation>("conversations");
  const conversation = await conversations.findOne({ _id: input.conversation_id });
  const agentId = conversation && getAgentId(conversation);
  if (!conversation || !agentId || conversation.metadata?.assistant_runtime !== "tome-native" ||
      conversation.metadata?.agentic_app_id !== "tome" ||
      conversation.metadata?.agentic_app_agent_id !== agentId) {
    throw new ApiError("This is not a native TOME conversation", 400, "TOME_CONVERSATION_REQUIRED");
  }
  // The registered agent identity grants use of the assistant; execution goes
  // directly to TOME's SDK runtime, with no Dynamic Agents model invocation.
  const agentDenied = await requireAgentUsePermission({
    subject: auth.subject, agentId, email: auth.email, isServiceAccount: false,
    trustedContext: { interaction: trustedInteractionFromRequest(request) },
  });
  if (agentDenied) return agentDenied;
  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) throw new ApiError("TOME agent is not configured", 503, "AGENT_NOT_CONFIGURED");

  const readable = await listReadableTomeProjects(auth.subject, {
    isAdmin: await isTomeAdminSubject(auth.subject),
  });
  const catalog: ChildProjectSnapshot[] = readable.map<ChildProjectSnapshot>((project) => ({
    project_id: String(project._id), slug: project.slug, name: project.title || project.name,
    project_type: project.type === "bhag" || project.type === "area" ? project.type : "project",
    bhags: project.labels?.initiatives ?? [], areas: project.labels?.areas ?? [],
  })).sort((a, b) => a.project_id.localeCompare(b.project_id));
  if (!catalog.length) throw new ApiError("No readable TOME entities", 403, "TOME_READ_REQUIRED");
  // A changed access catalog starts a new SDK context, so revoked material
  // cannot survive in a resumed model transcript. Shared-chat callers also
  // get distinct SDK sessions keyed by their immutable user subject.
  const catalogHash = createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
  const sessionId = createHash("sha256").update(JSON.stringify([input.conversation_id, auth.subject])).digest("hex");
  const sessions = await getCollection<NativeChatSession>("tome_global_chat_sessions");
  await sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  await sessions.updateOne({ _id: sessionId }, {
    $setOnInsert: { expires_at: new Date(Date.now() + 7 * 86400_000) },
  }, { upsert: true });
  const leaseId = randomUUID();
  const state = await sessions.findOneAndUpdate({
    _id: sessionId,
    $or: [{ lease_until: { $lte: new Date() } }, { lease_until: { $exists: false } }],
  }, { $set: { lease_id: leaseId, lease_until: new Date(Date.now() + 360_000), expires_at: new Date(Date.now() + 7 * 86400_000) } },
  { returnDocument: "before" });
  if (!state) throw new ApiError("TOME is already responding in this conversation", 409, "TOME_CHAT_BUSY");
  const body: AgentChatRequest = {
    global_chat: true, message: input.message, role: "viewer",
    sdk_session_id: state.catalog_hash === catalogHash ? state.sdk_session_id ?? null : null,
    actor_sub: auth.subject, actor_email: auth.email ?? null, credentials: {}, stable_pages: {},
    issue_context: { decisions: [], critical: [], decision_count: 0, critical_count: 0, decision_truncated: false, critical_truncated: false },
    snapshot: {
      project_id: `global-chat-${sessionId}`, slug: "", name: "TOME", charter: "", phase: null, cadence: null,
      project_type: "project", repos: [], webex_rooms: [], confluence_spaces: [], child_projects: [], readable_projects: catalog,
    },
  };
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 290_000);
  const release = async () => {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    await sessions.updateOne({ _id: sessionId, lease_id: leaseId }, { $unset: { lease_id: "", lease_until: "" } });
  };
  let upstream: Response;
  try {
    upstream = await fetch(`${agentUrl.replace(/\/$/, "")}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json", ...tomeAgentAuthorizationHeaders() },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) throw new ApiError(`TOME agent returned HTTP ${upstream.status}`, 502, "TOME_AGENT_ERROR");
  } catch (error) {
    await release();
    throw error;
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(output) {
      try {
        for await (const frame of parseSSEStream(upstream)) {
          if (frame.event === "session") {
            const data = JSON.parse(frame.data) as { session_id?: unknown };
            if (typeof data.session_id === "string") {
              await sessions.updateOne({ _id: sessionId, lease_id: leaseId }, {
                $set: { sdk_session_id: data.session_id, catalog_hash: catalogHash },
              });
            }
          }
          output.enqueue(encoder.encode(`event: ${frame.event}\ndata: ${frame.data}\n\n`));
        }
        output.close();
      } catch (error) {
        console.error("[TOME global chat] Stream failed", error instanceof Error ? error.name : "unknown");
        if (!controller.signal.aborted) {
          output.enqueue(encoder.encode('event: error\ndata: {"message":"TOME stream failed before completion"}\n\n'));
          output.close();
        } else output.error(new Error("TOME request was cancelled or timed out"));
      } finally { await release(); }
    },
    cancel() { controller.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
});
