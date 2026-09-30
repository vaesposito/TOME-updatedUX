// Tome chat — proxies an SSE stream from the reused TTT Python agent.
//
//   POST /api/tome/projects/[slug]/chat  → text/event-stream
//
// The browser (ChatPanel) posts `{ message, sdk_session_id }`. This route
// resolves the CAIPE project into the agent's `ChatRequest` contract
// (snapshot + stable pages), POSTs to the agent at `TOME_AGENT_URL/chat`, and
// pipes the agent's SSE bytes straight back. Until `TOME_AGENT_URL` is set it
// returns 503 with a clear message (rendered inline by ChatPanel).
//
// Mirrors caipe-ui's supervisor chat proxy (`app/api/chat/stream/route.ts`).
//
// Both turns of the conversation are persisted here, server-side, rather than
// by the browser after the fact: the user turn before proxying to the agent,
// and the assistant turn from a server-side tee of the SSE stream that keeps
// draining and persists on completion even if the browser navigates away or
// the tab closes mid-stream. See
// https://github.com/cisco-eti/ai-platform-engineering-mirror/issues/513.

import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { getMetrics, trackActiveStream } from "@/lib/metrics";
import { tomeAgentAuthorizationHeaders } from "@/lib/tome/agent-auth";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { buildChatRequest } from "@/lib/tome/agent-proxy";
import {
  readableTomeRollupProjects,
  resolveTomeGitHubCredential,
  rollupGitHubRepos,
} from "@/lib/tome/github-issue-scope";
import {
  buildTomeIssueContext,
  loadTomeIssueCache,
} from "@/lib/tome/github-issue-cache";
import {
  appendMessage,
  ensureSession,
  setSdkSessionId,
} from "@/lib/tome/chat-history-store";
import {
  appendChatRunEvents,
  createChatRun,
  finishChatRun,
  markChatRunRunning,
  watchChatRun,
} from "@/lib/tome/chat-run-store";
import type { ChatPart, ChatSession, ModelProvenance } from "@/types/tome";
import { myAgentConnectorsForSubject, myAgentConsentRevisionForSubject, myAgentConsentSubjectFromSession } from "@/lib/projects/myagent-source";
import { isMyAgentInteractiveBrowserAction } from "@/lib/tome/myagent-interactive";
import { compatibleChatResume, requestsMyAgent } from "@/lib/tome/myagent-chat-mode";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const userIdOf = (email?: string): string => email ?? "anonymous";

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);

  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) {
    throw new ApiError(
      "Tome agent is not configured (set TOME_AGENT_URL).",
      503,
      "AGENT_NOT_CONFIGURED",
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    sdk_session_id?: string | null;
    is_compact?: boolean;
    myagent_research?: boolean;
  };
  if (body.is_compact) {
    if (!body.sdk_session_id) {
      throw new ApiError(
        "`sdk_session_id` is required to compact",
        400,
        "BAD_REQUEST",
      );
    }
  } else if (!body.message || typeof body.message !== "string") {
    throw new ApiError("`message` (string) is required", 400, "BAD_REQUEST");
  }

  const ownedSession = await ensureSession(tctx.projectId, userIdOf(tctx.user.email));
  const research = body.is_compact ? ownedSession.myagent_research === true
    : body.myagent_research === true || requestsMyAgent(body.message ?? "");
  const subject = myAgentConsentSubjectFromSession(tctx.session);
  const sources = research ? myAgentConnectorsForSubject(tctx.project.sources, subject) : [];
  const revision = subject ? myAgentConsentRevisionForSubject(tctx.project.sources, subject) : null;
  if (research && !body.is_compact && (!subject || !tctx.user.email ||
      !isMyAgentInteractiveBrowserAction(request, tctx.session))) {
    throw new ApiError("Ask MyAgent from your signed-in TOME chat.", 403, "MYAGENT_BROWSER_REQUIRED");
  }
  if (research && !body.is_compact && (!sources.length || !revision)) {
    throw new ApiError("Choose the sources to query in this project's MyAgent settings, then ask again.", 400, "MYAGENT_SOURCES_REQUIRED");
  }
  const chatRequest = await buildChatRequest(tctx, {
    message: body.message ?? "",
    sdkSessionId: compatibleChatResume(body.sdk_session_id ?? null, ownedSession.sdk_session_id, ownedSession.myagent_research, research),
    isCompact: body.is_compact,
    myAgentResearch: research,
  });
  try {
    if (!research) {
      const rollup = await readableTomeRollupProjects(tctx);
      const repos = rollupGitHubRepos(rollup);
      const credential = await resolveTomeGitHubCredential(tctx);
      await loadTomeIssueCache({ repos, token: credential.token });
      chatRequest.issue_context = await buildTomeIssueContext(repos);
    }
  } catch (error) {
    // Issue context is supplementary. A GitHub outage must not block wiki chat.
    console.warn("[tome-chat] GitHub issue context unavailable", error);
  }

  // Compaction turns aren't real conversation content (no user message, and
  // the assistant side is just a boundary marker) — nothing to persist.
  let session: ChatSession | null = null;
  let runId: string | null = null;
  // Aborting the upstream fetch drops the agent connection, which cancels the
  // agent's turn. Fired when the run is stopped from any UI replica.
  const upstreamAbort = new AbortController();
  let unwatch = () => {};
  if (!body.is_compact && body.message) {
    session = ownedSession;
    await appendMessage(session, "user", body.message);
    runId = (await createChatRun(session, research ? {
      subject: subject!, sources, revision: revision!, seed: body.message,
    } : undefined))._id;
    if (research) {
      chatRequest.myagent_run_id = runId;
      chatRequest.myagent_sources = sources;
    }
    await markChatRunRunning(runId);
    unwatch = watchChatRun(runId, () => upstreamAbort.abort());
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${agentUrl.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...tomeAgentAuthorizationHeaders(),
      },
      body: JSON.stringify(chatRequest),
      signal: upstreamAbort.signal,
    });
  } catch (error) {
    unwatch();
    if (runId) await finishChatRun(runId, "failed", String(error));
    throw error;
  }

  if (!upstream.ok || !upstream.body) {
    unwatch();
    const detail = await upstream.text().catch(() => "");
    if (runId) {
      await finishChatRun(
        runId,
        "failed",
        `Agent chat failed (${upstream.status}). ${detail.slice(0, 500)}`,
      );
    }
    throw new ApiError(
      `Agent chat failed (${upstream.status}). ${detail.slice(0, 500)}`,
      502,
      "AGENT_ERROR",
    );
  }

  // Pipe the agent's SSE stream straight through to the browser, tracking it
  // as "active" for the tome_active_chat_sessions gauge for as long as the
  // stream stays open (closed, erroring, or the browser disconnecting all
  // decrement it exactly once — see trackActiveStream).
  const { tomeActiveChatSessions } = getMetrics();
  const trackedBody = trackActiveStream(upstream.body, tomeActiveChatSessions);

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };

  if (!session) {
    return new Response(trackedBody, { headers });
  }


  // Tee the stream: the browser gets one branch, byte-for-byte; the other is
  // parsed and persisted here, independent of whether the browser is still
  // reading by the time the agent finishes.
  const [clientBody, serverBody] = trackedBody.tee();
  headers["X-Tome-Session-Id"] = session._id!;
  headers["X-Tome-Run-Id"] = runId!;
  void persistAssistantTurn(
    serverBody,
    session,
    chatRequest.sdk_session_id ?? null,
    runId!,
    research,
  ).finally(unwatch);
  return new Response(clientBody, { headers });
});

/**
 * Turn a tool_call event into a readable chip label — mirrors ChatPanel's
 * client-side `describeTool` so a reloaded transcript renders identically to
 * what was shown live.
 */
function describeTool(tool: string, rawInput: unknown): string {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const name = tool.replace(/^mcp__[^_]+__/, "").replace(/^github_/, "gh:");
  const arg = pick("file_path", "path", "pattern", "query", "url", "repo", "prompt");
  if (!arg) return name;
  const short = arg.replace(/^\.\//, "");
  const quoted = /\s/.test(short) ? `"${short}"` : short;
  return `${name} ${quoted}`;
}

/**
 * Parses the agent's `event: token|tool_call|session|done|error` SSE frames
 * and persists the finished assistant turn — the server-side counterpart of
 * ChatPanel's `consumeSse`, run against the tee'd branch of the stream so it
 * keeps draining (and persisting) even after the browser stops listening.
 */
async function persistAssistantTurn(
  body: ReadableStream<Uint8Array>,
  session: ChatSession,
  fallbackSdkSessionId: string | null,
  runId: string,
  myAgentResearch = false,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const parts: ChatPart[] = [];
  let sdkSessionId = fallbackSdkSessionId;
  let model: string | undefined;
  let modelProvenance: ModelProvenance | undefined;
  let nextEventId = 1;
  let streamError: string | undefined;
  let persistenceError: string | undefined;

  const persistReplayEvents = async (
    events: { id: number; frame: string }[],
  ): Promise<void> => {
    try {
      await appendChatRunEvents(runId, events);
    } catch (error) {
      persistenceError ??= String((error as Error)?.message ?? error);
      console.error(`Failed to buffer TOME chat run ${runId}`, error);
    }
  };

  const appendToken = (text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === "text") last.text += text;
    else parts.push({ kind: "text", text });
  };

  const handleFrame = (frame: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }

    switch (event) {
      case "token":
        if (typeof data.text === "string") appendToken(data.text);
        break;
      case "tool_call": {
        const tool = String(data.tool ?? data.name ?? "tool");
        const input = (data.input ?? {}) as Record<string, unknown>;
        const fp =
          (typeof input.file_path === "string" && input.file_path) ||
          (typeof input.path === "string" && input.path) ||
          "";
        const pagePath = fp.replace(/^\.\//, "").trim();
        const isPage = /\.md$/.test(pagePath);
        parts.push({
          kind: "tool",
          label: describeTool(tool, data.input),
          ...(isPage ? { path: pagePath } : {}),
        });
        break;
      }
      case "session":
        if (typeof data.session_id === "string") sdkSessionId = data.session_id;
        break;
      case "done":
        if (typeof data.model === "string") model = data.model;
        if (data.model_provenance && typeof data.model_provenance === "object") {
          modelProvenance = data.model_provenance as ModelProvenance;
        }
        break;
      case "error":
        if (typeof data.message === "string") streamError = data.message;
        break;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      const replayEvents = [];
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, sep);
        replayEvents.push({ id: nextEventId++, frame });
        handleFrame(frame);
        buf = buf.slice(sep + 2);
      }
      await persistReplayEvents(replayEvents);
    }
    if (buf.trim()) {
      await persistReplayEvents([{ id: nextEventId++, frame: buf }]);
      handleFrame(buf);
    }
  } catch (error) {
    // Best-effort: fall through and persist whatever arrived before the
    // stream broke, rather than losing the whole turn.
    streamError = String((error as Error)?.message ?? error);
  }

  const text = parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
  try {
    if (parts.length) {
      await appendMessage(session, "assistant", text, parts, model, modelProvenance);
    }
    if (sdkSessionId) {
      await setSdkSessionId(session._id!, sdkSessionId, myAgentResearch);
    }
  } catch (error) {
    persistenceError ??= String((error as Error)?.message ?? error);
    console.error(`Failed to persist TOME chat run ${runId}`, error);
  }
  const error = streamError ?? persistenceError;
  await finishChatRun(
    runId,
    error ? "failed" : "completed",
    error,
  );
}
