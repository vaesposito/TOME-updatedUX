/** Global native TOME chat, with GRID conversation authorization and persistence. */
import { NextRequest, NextResponse } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { trustedInteractionFromRequest } from "@/lib/authz/trusted-interaction";
import { authenticateRequest } from "@/lib/da-proxy";
import { getCollection } from "@/lib/mongodb";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";
import { startTomeGlobalTurn } from "@/lib/tome/global-chat-service";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { getTomeNativeChatAgentId } from "@/lib/tome/chat-routing";
import { getAgentId } from "@/types/a2a";
import type { Conversation } from "@/types/mongodb";
import { requireConversationWriteAccess } from "../../v1/chat/_conversation-authz";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isTomeServerEnabled()) throw new ApiError("Not found", 404, "NOT_FOUND");
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.isServiceAccount || !auth.subject) {
    throw new ApiError("Interactive user identity required", 403, "TOME_USER_REQUIRED");
  }
  const input = await request.json() as { message?: unknown; conversation_id?: unknown; verify_sources?: unknown };
  if (input.verify_sources !== undefined && typeof input.verify_sources !== "boolean") {
    throw new ApiError("verify_sources must be a boolean", 400, "BAD_REQUEST");
  }
  if (typeof input.message !== "string" || !input.message.trim() || input.message.length > 12_000 ||
      typeof input.conversation_id !== "string" || input.conversation_id.length > 128) {
    throw new ApiError("A message and conversation_id are required", 400, "BAD_REQUEST");
  }
  const denied = await requireConversationWriteAccess(auth, input.conversation_id);
  if (denied) return denied;
  const conversations = await getCollection<Conversation>("conversations");
  const conversation = await conversations.findOne({ _id: input.conversation_id });
  const agentId = conversation && getAgentId(conversation);
  const nativeAgentId = getTomeNativeChatAgentId();
  if (!nativeAgentId) throw new ApiError("TOME chat agent is not configured", 503, "AGENT_NOT_CONFIGURED");
  if (!conversation || !agentId || agentId !== nativeAgentId ||
      conversation.client_type !== "webui" || conversation.created_by_service_account) {
    throw new ApiError("This is not a native TOME conversation", 400, "TOME_CONVERSATION_REQUIRED");
  }
  // The registered agent identity grants use of the assistant; execution goes
  // directly to TOME's retrieval runtime, with no Dynamic Agents invocation.
  const agentDenied = await requireAgentUsePermission({
    subject: auth.subject, agentId, email: auth.email, isServiceAccount: false,
    trustedContext: { interaction: trustedInteractionFromRequest(request) },
  });
  if (agentDenied) return agentDenied;
  const turn = await startTomeGlobalTurn({
    subject: auth.subject, email: auth.email, message: input.message,
    session: { kind: "grid", id: input.conversation_id }, signal: request.signal,
    verifySources: input.verify_sources as boolean | undefined,
  });
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = () => {
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
  };
  const stream = new ReadableStream({
    async start(output) {
      // Model reasoning and live-source comparison can be silent for longer
      // than a proxy's idle timeout. SSE comments keep the connection alive
      // without adding chat content or changing the bounded turn deadline.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          output.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          stopHeartbeat();
          turn.cancel();
        }
      }, 10_000);
      try {
        for await (const frame of turn.events) {
          if (closed) break;
          output.enqueue(encoder.encode(`event: ${frame.event}\ndata: ${frame.data}\n\n`));
        }
        if (!closed) output.close();
      } catch (error) {
        if (closed) return;
        console.error("[TOME global chat] Stream failed", error instanceof Error ? error.name : "unknown");
        if (!request.signal.aborted) {
          output.enqueue(encoder.encode('event: error\ndata: {"message":"TOME stream failed before completion"}\n\n'));
          output.close();
        } else output.error(new Error("TOME request was cancelled or timed out"));
      } finally {
        stopHeartbeat();
      }
    },
    cancel() { stopHeartbeat(); turn.cancel(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
});
