"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUp, Bot, Eraser, Loader2, Sparkles, Square, Wrench } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";

import { AuditNotice } from "@/components/chat/AuditNotice";
import type { Feedback } from "@/components/chat/FeedbackButton";
import { MessageActions } from "@/components/chat/MessageActions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { MarkdownRenderer } from "@/components/shared/timeline";
import type { GlossaryResolver } from "@/lib/tome/tome-links";
import type { ChatPart as Part, ModelProvenance } from "@/types/tome";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { requestsMyAgent } from "@/lib/tome/myagent-chat-mode";
import { MYAGENT_BROWSER_ACTION_HEADER } from "@/lib/tome/myagent-interactive";
import {
  emptyTomeChatViewState,
  tomeChatKey,
  type TomeChatMessage as ChatMsg,
  type TomeChatRole as Role,
  useTomeChatStore,
} from "@/store/tome-chat-store";

/**
 * Tome chat — the primary surface of a project's tome. Talks to the tome chat
 * agent via `POST /api/tome/projects/<slug>/chat`, which proxies an SSE stream
 * from the reused TTT Python agent (contract: `event: token|tool_call|
 * tool_result|session|done|error`). Grounded in the project's wiki; the agent
 * can cite and edit pages.
 *
 * Until the agent service is wired (`TOME_AGENT_URL`), the endpoint returns a
 * clear "not connected" message which renders inline — no throwaway UI.
 */

// A turn is an ordered list of parts in stream-arrival order (text deltas and
// tool calls interleaved). The shape is shared with the persistence layer as
// `ChatPart` (@/types/tome) so a reloaded transcript re-renders faithfully.

const newMessageId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTEXT_COMPACT_THRESHOLD = 75;

// The browser-side reader for each chat's live send, so Stop can detach it and
// a late frame from the stopped turn can't land on the next one. Module scope
// because a send outlives the ChatPanel that started it (navigation).
const liveSendAborts = new Map<string, AbortController>();

function isTomeSessionId(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}
interface Props {
  slug: string;
  /** Human-readable project name used by the global live-stream navigator. */
  projectTitle?: string;
  /** Called when the agent reports it wrote a page, so the wiki can refresh. */
  onPagesChanged?: () => void;
  /** Open a wiki page (referenced by a tool chip) in the artifact pane. */
  onOpenPage?: (path: string) => void;
  /** Resolve a glossary term slug to its definition for the hover card. */
  glossaryPreview?: GlossaryResolver;
  /** One-shot prompt supplied by another Tome surface, such as New page. */
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
}

export function ChatPanel({
  slug,
  projectTitle,
  onPagesChanged,
  onOpenPage,
  glossaryPreview,
  initialPrompt,
  onInitialPromptConsumed,
}: Props) {
  const searchParams = useSearchParams();
  const viewSessionId = searchParams.get("session");
  const chatKey = tomeChatKey(slug, viewSessionId);
  const storedChat = useTomeChatStore((state) => state.chats[chatKey]);
  const updateChat = useTomeChatStore((state) => state.updateChat);
  const hydrateChat = useTomeChatStore((state) => state.hydrateChat);
  const chat = storedChat ?? emptyTomeChatViewState();
  const {
    messages,
    streaming,
    compacting,
    sessionId,
    readOnly: readOnlyView,
    sessionOwner,
    contextUsage,
    resumeRunId,
    myAgentResearch = false,
  } = chat;
  const [loadingHistory, setLoadingHistory] = useState(!storedChat?.hydrated);
  const [confirmDialog, setConfirmDialog] = useState<"clear" | "compact" | null>(null);
  const [autoCompact, setAutoCompact] = useState(true);
  const [sessionContextTooLarge, setSessionContextTooLarge] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const updateMessages = useCallback(
    (updater: (messages: ChatMsg[]) => ChatMsg[]) => {
      updateChat(chatKey, (current) => ({
        ...current,
        messages: updater(current.messages),
      }));
    },
    [chatKey, updateChat],
  );

  // Keep the transcript pinned to the latest turn, but only if the user
  // hasn't scrolled up to read earlier messages.
  useAutoScroll(scrollRef, [messages]);

  // Initial-load jump-to-bottom: the `[messages]` effect above fires on the
  // sync render right after history hydrates, but markdown/code blocks haven't
  // actually laid out yet, so `scrollHeight` is the pre-layout value and the
  // jump lands part-way down. Wait until `loadingHistory` flips false (history
  // is in state), then scroll on the next two animation frames — by then the
  // browser has painted real heights. Behavior `auto` so it doesn't animate.
  useEffect(() => {
    if (loadingHistory) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [loadingHistory]);

  // Load the durable transcript (tome-owned store) on mount, and seed both the
  // tome session id and the SDK resume hint so the chat continues across reloads.
  useEffect(() => {
    let cancelled = false;
    const cached = useTomeChatStore.getState().chats[chatKey];
    if (cached?.hydrated) {
      setLoadingHistory(false);
      return () => {
        cancelled = true;
      };
    }
    setLoadingHistory(true);
    (async () => {
      try {
        const historyUrl = viewSessionId
          ? `/api/tome/projects/${slug}/chat/history?sessionId=${encodeURIComponent(viewSessionId)}`
          : `/api/tome/projects/${slug}/chat/history`;
        const res = await fetch(historyUrl);
        if (!res.ok) return;
        const data = (await res.json().catch(() => null))?.data;
        if (cancelled || !data) return;
        const msgs: ChatMsg[] = (data.messages ?? []).map(
          (m: {
            role: Role;
            content?: string;
            parts?: Part[] | null;
            model?: string | null;
            model_provenance?: ModelProvenance | null;
          }) => ({
            id: newMessageId(),
            role: m.role,
            parts:
              Array.isArray(m.parts) && m.parts.length
                ? m.parts
                : [{ kind: "text", text: m.content ?? "" }],
            model: m.model ?? undefined,
            modelProvenance: m.model_provenance ?? undefined,
          }),
        );
        const activeRunId =
          !viewSessionId &&
          data.activeRun?.sessionId === data.session?.id &&
          typeof data.activeRun?.id === "string"
            ? data.activeRun.id
            : null;
        hydrateChat(chatKey, {
          messages: activeRunId
            ? [
                ...msgs,
                {
                  id: newMessageId(),
                  role: "assistant",
                  parts: [],
                  pending: true,
                },
              ]
            : msgs,
          streaming: Boolean(activeRunId),
          compacting: false,
          hydrated: true,
          sessionId: data.session?.id ?? null,
          sdkSessionId: data.session?.sdkSessionId ?? null,
          myAgentResearch: data.session?.myAgentResearch === true,
          readOnly: Boolean(data.readOnly),
          sessionOwner:
            typeof data.sessionOwner === "string"
              ? data.sessionOwner
              : data.session?.userId ?? null,
          contextUsage: null,
          resumeRunId: activeRunId,
          activeRunId,
          ...(activeRunId
            ? {
                streamDestination: {
                  href: `/projects/${slug}/tome`,
                  label: projectTitle ?? slug,
                },
              }
            : {}),
        });
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatKey, hydrateChat, projectTitle, slug, viewSessionId]);

  // A full reload loses the browser's original fetch, but the server keeps
  // consuming and buffering the upstream run. Replay from event 0 to rebuild
  // the pending assistant turn, then follow it until the run is terminal.
  useEffect(() => {
    if (!resumeRunId) return;
    const controller = new AbortController();

    const patchPendingAssistant = (fn: (message: ChatMsg) => ChatMsg) => {
      updateMessages((current) => {
        let index = -1;
        for (let i = current.length - 1; i >= 0; i -= 1) {
          if (current[i].role === "assistant" && current[i].pending) {
            index = i;
            break;
          }
        }
        if (index < 0) return current;
        const copy = current.slice();
        copy[index] = fn(copy[index]);
        return copy;
      });
    };

    void (async () => {
      let turnModel: string | null = null;
      let turnModelProvenance: ModelProvenance | null = null;
      try {
        const res = await fetch(
          `/api/tome/projects/${slug}/chat/runs/${encodeURIComponent(resumeRunId)}`,
          { signal: controller.signal },
        );
        if (!res.ok || !res.body) {
          throw new Error(`Unable to resume chat (${res.status})`);
        }
        await consumeSse(res.body, {
          onToken: (text) => {
            patchPendingAssistant((message) => {
              const parts = message.parts.slice();
              const last = parts[parts.length - 1];
              if (last?.kind === "text") {
                parts[parts.length - 1] = { kind: "text", text: last.text + text };
              } else {
                parts.push({ kind: "text", text });
              }
              return { ...message, parts };
            });
          },
          onTool: (label, path) => {
            patchPendingAssistant((message) => ({
              ...message,
              parts: [...message.parts, { kind: "tool", label, path }],
            }));
          },
          onSession: (id) => {
            updateChat(chatKey, (current) => ({
              ...current,
              sdkSessionId: id,
            }));
          },
          onPageWritten: () => onPagesChanged?.(),
          onError: (message, code) => {
            if (code === "session_context_exhausted") setSessionContextTooLarge(true);
            patchPendingAssistant((pending) => ({
              ...pending,
              parts: pending.parts.some(
                (part) => part.kind === "text" && part.text.trim(),
              )
                ? pending.parts
                : [{ kind: "text", text: `⚠️ ${message}` }],
            }));
          },
          onContextUsage: (data) => {
            if (typeof data.percentage === "number") {
              updateChat(chatKey, (current) => ({
                ...current,
                contextUsage: { percentage: data.percentage! },
              }));
            }
          },
          onDone: (data) => {
            turnModel = data.model ?? null;
            turnModelProvenance = data.modelProvenance ?? null;
          },
        });
        patchPendingAssistant((message) => ({
          ...message,
          pending: false,
          model: turnModel ?? undefined,
          modelProvenance: turnModelProvenance ?? undefined,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        patchPendingAssistant((message) => ({
          ...message,
          pending: false,
          parts: message.parts.length
            ? message.parts
            : [
                {
                  kind: "text",
                  text: `⚠️ ${String((error as Error)?.message ?? error)}`,
                },
              ],
        }));
      } finally {
        if (!controller.signal.aborted) {
          updateChat(chatKey, (current) => ({
            ...current,
            streaming: false,
            resumeRunId: null,
            activeRunId: null,
          }));
        }
      }
    })();

    return () => controller.abort();
  }, [chatKey, onPagesChanged, resumeRunId, slug, updateChat, updateMessages]);

  // Thumbs up/down for a single turn (shared `MessageActions`/`FeedbackButton`).
  // Feedback itself is best-effort telemetry (Langfuse + Mongo `feedback`
  // collection) — it doesn't touch the tome-owned transcript/session state.
  const updateFeedback = useCallback((id: string, feedback: Feedback) => {
    updateMessages((msgs) =>
      msgs.map((m) => (m.id === id ? { ...m, feedback } : m)),
    );
  }, [updateMessages]);

  // Clear: start a fresh session. Wipes the visible transcript and the SDK
  // resume hint together — a deliberate full reset, not just an internal
  // state fixup (old history stays in Mongo, just no longer "active").
  const handleClear = useCallback(async () => {
    const current = useTomeChatStore.getState().chats[chatKey];
    if (current?.streaming || current?.compacting) return;
    let nextSessionId: string | null = null;
    try {
      const res = await fetch(`/api/tome/projects/${slug}/chat/history`, {
        method: "DELETE",
      });
      const sid = res.ok
        ? (await res.json().catch(() => null))?.data?.sessionId
        : null;
      nextSessionId = typeof sid === "string" ? sid : null;
    } finally {
      updateChat(chatKey, (chat) => ({
        ...chat,
        messages: [],
        sessionId: nextSessionId,
        sdkSessionId: null,
        myAgentResearch: false,
        contextUsage: null,
        resumeRunId: null,
      }));
      setSessionContextTooLarge(false);
    }
  }, [chatKey, slug, updateChat]);

  // Compact: trigger the SDK's own `/compact` against the current session.
  // No-op if there's no session yet (nothing to compact).
  const handleCompact = useCallback(async (): Promise<boolean> => {
    const current = useTomeChatStore.getState().chats[chatKey];
    if (current?.streaming || current?.compacting || !current?.sdkSessionId) return false;
    updateChat(chatKey, (chat) => ({ ...chat, compacting: true }));
    try {
      const res = await fetch(`/api/tome/projects/${slug}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdk_session_id: current.sdkSessionId,
          is_compact: true,
        }),
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        updateMessages((m) => [
          ...m,
          { id: newMessageId(), role: "assistant", system: true, parts: [{ kind: "text", text: `⚠️ Compact failed. ${detail.slice(0, 300)}` }] },
        ]);
        return false;
      }
      // Only claim success if the SDK actually emitted a compact_boundary —
      // an errored/no-op stream must not tell the user it worked.
      let boundarySeen = false;
      let preTokens: number | null = null;
      let erroredMessage: string | null = null;
      await consumeSse(res.body, {
        onToken: () => {},
        onTool: () => {},
        onSession: (id) => {
          updateChat(chatKey, (chat) => ({ ...chat, sdkSessionId: id }));
        },
        onPageWritten: () => {},
        onError: (message) => {
          erroredMessage = message;
        },
        // Not wired to contextUsage: the post-compact snapshot reflects
        // only the compacted transcript, not the wiki system prompt (rebuilt
        // fresh on the next real turn) — the next turn's own snapshot lands instead.
        onCompact: (data) => {
          boundarySeen = true;
          preTokens = data.pre_tokens ?? null;
        },
      });
      const text = boundarySeen
        ? preTokens
          ? `Context compacted from ~${preTokens.toLocaleString()} tokens.`
          : "Context compacted."
        : `⚠️ Compact did not complete${erroredMessage ? `: ${erroredMessage}` : " (no confirmation from the agent)."}`;
      updateMessages((m) => [
        ...m,
        { id: newMessageId(), role: "assistant", system: true, parts: [{ kind: "text", text }] },
      ]);
      return boundarySeen;
    } catch (error) {
      updateMessages((m) => [
        ...m,
        { id: newMessageId(), role: "assistant", system: true, parts: [{ kind: "text", text: `⚠️ Compact failed. ${String((error as Error)?.message ?? error)}` }] },
      ]);
      return false;
    } finally {
      updateChat(chatKey, (chat) => ({ ...chat, compacting: false }));
    }
  }, [chatKey, slug, updateChat, updateMessages]);

  const send = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    let current = useTomeChatStore.getState().chats[chatKey] ?? emptyTomeChatViewState();
    // Also blocked while compacting: both calls resume the same sdk_session_id,
    // so a concurrent send would race the SDK's compaction turn.
    if (!text || current.streaming || current.compacting || current.readOnly || sessionContextTooLarge) return;
    if (
      autoCompact &&
      current.contextUsage?.percentage >= CONTEXT_COMPACT_THRESHOLD &&
      current.sdkSessionId
    ) {
      const compacted = await handleCompact();
      if (!compacted) return;
      current = useTomeChatStore.getState().chats[chatKey] ?? emptyTomeChatViewState();
      if (current.streaming || current.compacting || current.readOnly) return;
    }
    updateChat(chatKey, (chat) => ({
      ...chat,
      streaming: true,
      streamDestination: {
        href: `/projects/${slug}/tome`,
        label: projectTitle ?? slug,
      },
      resumeRunId: null,
      activeRunId: null,
      messages: [
        ...chat.messages,
        { id: newMessageId(), role: "user", parts: [{ kind: "text", text }] },
        { id: newMessageId(), role: "assistant", parts: [], pending: true },
      ],
    }));

    // Both turns are persisted server-side (see the `chat` route) so a
    // navigation or dropped connection mid-stream can't lose the message.

    // Mutate the last (assistant) message in place as the stream arrives.
    const patchLast = (fn: (m: ChatMsg) => ChatMsg) =>
      updateMessages((msgs) => {
        if (msgs.length === 0) return msgs;
        const copy = msgs.slice();
        copy[copy.length - 1] = fn(copy[copy.length - 1]);
        return copy;
      });

    // Append a token to the trailing text part, or open a new one if the last
    // part was a tool — this is what keeps text/tool order intact.
    const appendToken = (t: string) => {
      patchLast((m) => {
        const parts = m.parts.slice();
        const last = parts[parts.length - 1];
        if (last && last.kind === "text") {
          parts[parts.length - 1] = { kind: "text", text: last.text + t };
        } else {
          parts.push({ kind: "text", text: t });
        }
        return { ...m, parts };
      });
    };

    const pushTool = (label: string, path?: string) => {
      patchLast((m) => ({
        ...m,
        parts: [...m.parts, { kind: "tool", label, path }],
      }));
    };

    const pushErrorIfEmpty = (message: string, code?: string) => {
      if (code === "session_context_exhausted") setSessionContextTooLarge(true);
      patchLast((m) => {
        const hasText = m.parts.some(
          (p) => p.kind === "text" && p.text.trim(),
        );
        return {
          ...m,
          pending: false,
          parts: hasText
            ? m.parts
            : [...m.parts, { kind: "text", text: `⚠️ ${message}` }],
        };
      });
    };

    const abort = new AbortController();
    liveSendAborts.set(chatKey, abort);

    try {
      const research = current.myAgentResearch === true || requestsMyAgent(text);
      updateChat(chatKey, (chat) => ({ ...chat, myAgentResearch: research }));
      const res = await fetch(`/api/tome/projects/${slug}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [MYAGENT_BROWSER_ACTION_HEADER]: "1" },
        body: JSON.stringify({
          message: text,
          sdk_session_id: current.sdkSessionId,
          myagent_research: research,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        pushErrorIfEmpty(
          res.status === 503
            ? "The tome agent isn't connected yet (set `TOME_AGENT_URL`). Chat will work once the agent service is running."
            : `Chat failed (${res.status}). ${detail.slice(0, 300)}`,
        );
        return;
      }

      // The route persists both turns server-side; it hands back the durable
      // session id (created on the very first message) so the client can keep
      // pointing at it for reads/feedback grouping.
      const persistedSessionId = res.headers.get("X-Tome-Session-Id");
      const runId = res.headers.get("X-Tome-Run-Id");
      updateChat(chatKey, (chat) => ({
        ...chat,
        ...(persistedSessionId ? { sessionId: persistedSessionId } : {}),
        activeRunId: runId,
      }));

      let turnModel: string | null = null;
      let turnModelProvenance: ModelProvenance | null = null;
      await consumeSse(res.body, {
        onToken: appendToken,
        onTool: pushTool,
        onSession: (id) => {
          updateChat(chatKey, (chat) => ({ ...chat, sdkSessionId: id }));
        },
        onPageWritten: () => onPagesChanged?.(),
        onError: pushErrorIfEmpty,
        onContextUsage: (data) => {
          if (typeof data.percentage === "number") {
            updateChat(chatKey, (chat) => ({
              ...chat,
              contextUsage: { percentage: data.percentage! },
            }));
          }
        },
        onDone: (data) => {
          turnModel = data.model ?? null;
          turnModelProvenance = data.modelProvenance ?? null;
        },
      });
      patchLast((m) => ({
        ...m,
        pending: false,
        model: turnModel ?? undefined,
        modelProvenance: turnModelProvenance ?? undefined,
      }));
    } catch (e) {
      // Stop already settled this turn's message and state.
      if (abort.signal.aborted) return;
      pushErrorIfEmpty(String((e as Error)?.message ?? e));
    } finally {
      if (liveSendAborts.get(chatKey) === abort) liveSendAborts.delete(chatKey);
      if (!abort.signal.aborted) {
        updateChat(chatKey, (chat) => ({ ...chat, streaming: false, activeRunId: null }));
      }
    }
  }, [autoCompact, chatKey, handleCompact, onPagesChanged, projectTitle, sessionContextTooLarge, slug, updateChat, updateMessages]);

  // Regenerate: re-sends the same prompt as a fresh turn (append, not
  // in-place replace — the SDK session already has the prior answer in its
  // own history, so this mirrors the main chat's retry semantics rather than
  // attempting a true rewrite of agent-side context).
  const handleRegenerate = useCallback(
    (text: string) => {
      const current = useTomeChatStore.getState().chats[chatKey];
      if (current?.streaming || current?.compacting) return;
      void send(text);
    },
    [chatKey, send],
  );

  // Stable references, required for `MessageRow`/`Composer` memoization.
  // Settle the turn locally right away, then ask the server to stop the run.
  // Clearing resumeRunId tears down a reload-resume stream via its effect.
  const handleStop = useCallback(() => {
    const current = useTomeChatStore.getState().chats[chatKey];
    const runId = current?.activeRunId;
    if (!current?.streaming || !runId) return;
    liveSendAborts.get(chatKey)?.abort();
    liveSendAborts.delete(chatKey);
    updateChat(chatKey, (chat) => {
      const messages = chat.messages.slice();
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message.role !== "assistant" || !message.pending) continue;
        messages[i] = {
          ...message,
          pending: false,
          parts: [...message.parts, { kind: "text", text: "\n\n_Stopped._" }],
        };
        break;
      }
      return { ...chat, messages, streaming: false, resumeRunId: null, activeRunId: null };
    });
    void fetch(
      `/api/tome/projects/${slug}/chat/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" },
    ).catch((error) => console.error("Failed to stop TOME chat run", error));
  }, [chatKey, slug, updateChat]);

  const handleComposerSend = useCallback(
    (text: string) => void send(text),
    [send],
  );

  const handleMyAgentResearchChange = useCallback(
    (checked: boolean) => {
      updateChat(chatKey, (chat) => ({ ...chat, myAgentResearch: checked }));
    },
    [chatKey, updateChat],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-1 border-b px-3 py-1.5">
        {contextUsage && (
          <span
            className="mr-1 text-xs text-muted-foreground"
            title="Live context-window occupancy for this session"
          >
            context: {Math.round(contextUsage.percentage)}%
          </span>
        )}
        <label className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground" title={`Compact automatically before the next message at ${CONTEXT_COMPACT_THRESHOLD}% context`}>
          Auto-compact
          <Switch
            checked={autoCompact}
            onCheckedChange={setAutoCompact}
            disabled={readOnlyView || streaming || compacting}
            aria-label="Auto-compact at 75% context"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => setConfirmDialog("compact")}
          disabled={readOnlyView || streaming || compacting || !messages.length}
          title="Summarize the conversation so far to free up context"
        >
          {compacting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Compact
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => setConfirmDialog("clear")}
          disabled={readOnlyView || streaming || compacting || !messages.length}
          title="Start a fresh chat session"
        >
          <Eraser className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
      {readOnlyView && (
        <div className="border-b bg-muted/40 px-4 py-2 text-center text-xs text-muted-foreground">
          Viewing Tome chat history
          {sessionOwner ? ` for ${sessionOwner}` : ""}
          {isTomeSessionId(sessionId) ? ` (session ${sessionId})` : ""}
        </div>
      )}
      {contextUsage && contextUsage.percentage >= CONTEXT_COMPACT_THRESHOLD && !sessionContextTooLarge && (
        <div className="flex items-center justify-between gap-3 border-b bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <span>
            Context is {Math.round(contextUsage.percentage)}% full.
            {autoCompact
              ? " Auto-compact will run before your next message."
              : " Compact now or start a new chat before continuing."}
          </span>
          {!autoCompact && (
            <Button size="sm" variant="outline" onClick={() => void handleCompact()} disabled={streaming || compacting}>
              Compact now
            </Button>
          )}
        </div>
      )}
      {sessionContextTooLarge && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm">
          <span>Session context too large — start a new chat to continue.</span>
          <Button size="sm" variant="outline" onClick={() => void handleClear()} disabled={streaming || compacting}>
            Start new chat
          </Button>
        </div>
      )}
      <ScrollArea viewportRef={scrollRef} className="flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-8">
          {messages.length === 0 && !loadingHistory && <EmptyState slug={slug} />}
          {messages.map((m, i) => {
            // Regenerate needs the prompt that produced this turn: the
            // message's own text if it's a user turn, else the nearest
            // preceding user turn (mirrors the main chat's getRetryContent).
            let retryText: string | null = null;
            if (m.role === "user") {
              retryText = textOfParts(m.parts);
            } else {
              for (let j = i - 1; j >= 0; j--) {
                if (messages[j].role === "user") {
                  retryText = textOfParts(messages[j].parts);
                  break;
                }
              }
            }
            return (
              <MessageRow
                key={m.id}
                msg={m}
                conversationId={isTomeSessionId(sessionId) ? sessionId : undefined}
                tomeProjectSlug={slug}
                tomeSessionId={isTomeSessionId(sessionId) ? sessionId : undefined}
                userQuestion={m.role === "assistant" ? retryText : undefined}
                retryText={retryText}
                onOpenPage={onOpenPage}
                glossaryPreview={glossaryPreview}
                onFeedbackChange={updateFeedback}
                onRetry={handleRegenerate}
                retryDisabled={readOnlyView || streaming || compacting}
              />
            );
          })}
        </div>
      </ScrollArea>

      <Composer
        readOnlyView={readOnlyView}
        streaming={streaming}
        compacting={compacting}
        loadingHistory={loadingHistory}
        sessionContextTooLarge={sessionContextTooLarge}
        myAgentResearch={myAgentResearch}
        onMyAgentResearchChange={handleMyAgentResearchChange}
        initialPrompt={initialPrompt}
        onInitialPromptConsumed={onInitialPromptConsumed}
        viewSessionId={viewSessionId}
        onSend={handleComposerSend}
        canStop={streaming && Boolean(chat.activeRunId)}
        onStop={handleStop}
      />

      <Dialog open={confirmDialog === "compact"} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compact this conversation?</DialogTitle>
            <DialogDescription>
              Older turns will be summarized to free up context. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmDialog(null);
                void handleCompact();
              }}
            >
              Compact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDialog === "clear"} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a fresh chat session?</DialogTitle>
            <DialogDescription>
              The current conversation won&apos;t be active anymore — history isn&apos;t deleted, just retired.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDialog(null);
                void handleClear();
              }}
            >
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">Chat with tome</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Ask about <span className="font-medium">{slug}</span>: status, recent
        changes, what shipped, who&apos;s working on what. The agent reads this
        project&apos;s wiki and sources, and can update pages for you.
      </p>
    </div>
  );
}

// Owns its own keystroke-local `input` state so typing never re-renders
// `ChatPanel` (and with it the full, unwindowed message list) — see #655.
const Composer = memo(function Composer({
  readOnlyView,
  streaming,
  compacting,
  loadingHistory,
  sessionContextTooLarge,
  myAgentResearch,
  onMyAgentResearchChange,
  initialPrompt,
  onInitialPromptConsumed,
  viewSessionId,
  onSend,
  canStop,
  onStop,
}: {
  readOnlyView: boolean;
  streaming: boolean;
  compacting: boolean;
  loadingHistory: boolean;
  sessionContextTooLarge: boolean;
  myAgentResearch: boolean;
  onMyAgentResearchChange: (checked: boolean) => void;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
  viewSessionId: string | null;
  onSend: (text: string) => void;
  canStop: boolean;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");

  // Seed `input` from the one-shot prompt during render (not in an effect —
  // it's local state derived from a prop, not a sync to an external system).
  // State, not a ref, tracks what's already been consumed: refs can't be
  // read during render.
  const [consumedInitialPrompt, setConsumedInitialPrompt] = useState<string | null>(null);
  if (initialPrompt && !viewSessionId && consumedInitialPrompt !== initialPrompt) {
    setConsumedInitialPrompt(initialPrompt);
    setInput(initialPrompt);
  }

  // Notifying the parent is a real side effect, so it stays in an effect.
  useEffect(() => {
    if (initialPrompt && !viewSessionId && consumedInitialPrompt === initialPrompt) {
      onInitialPromptConsumed?.();
    }
  }, [initialPrompt, onInitialPromptConsumed, viewSessionId, consumedInitialPrompt]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    onSend(text);
  };

  return (
    <div className="pointer-events-none px-4 pb-5 pt-2">
      <label className="pointer-events-auto mx-auto mb-2 flex max-w-4xl items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={myAgentResearch}
          disabled={readOnlyView || streaming || compacting}
          onChange={(event) => onMyAgentResearchChange(event.target.checked)} />
        Ask MyAgent · selected Outlook, SharePoint and Salesforce sources
      </label>
      <div className="pointer-events-auto mx-auto flex max-w-4xl items-center gap-2 rounded-2xl border bg-background/95 px-3 py-2 shadow-lg backdrop-blur transition focus-within:ring-2 focus-within:ring-ring">
        <TextareaAutosize
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          minRows={1}
          maxRows={10}
          disabled={readOnlyView || compacting || loadingHistory || sessionContextTooLarge}
          placeholder={readOnlyView ? "Read-only session view" : loadingHistory ? "Loading conversation…" : compacting ? "Compacting…" : sessionContextTooLarge ? "Start a new chat to continue" : "Ask about this project…"}
          className="flex-1 resize-none border-0 bg-transparent py-1 text-sm leading-relaxed outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        />
        {streaming ? (
          <Button
            size="icon"
            className="shrink-0 rounded-full"
            onClick={onStop}
            disabled={!canStop}
            title="Stop"
            aria-label="Stop"
          >
            {canStop ? (
              <Square className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
          </Button>
        ) : (
          <Button
            size="icon"
            className="shrink-0 rounded-full"
            onClick={submit}
            disabled={readOnlyView || loadingHistory || !input.trim() || compacting || sessionContextTooLarge}
            title={compacting ? "Compacting…" : "Send"}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="pointer-events-none mt-1.5 text-center text-xs text-muted-foreground">
        <AuditNotice />
      </p>
    </div>
  );
});

// Memoized: a row only re-renders when its own props change, not on every
// unrelated ChatPanel re-render (e.g. a streaming token for another message).
const MessageRow = memo(function MessageRow({
  msg,
  conversationId,
  tomeProjectSlug,
  tomeSessionId,
  userQuestion,
  retryText,
  onOpenPage,
  glossaryPreview,
  onFeedbackChange,
  onRetry,
  retryDisabled,
}: {
  msg: ChatMsg;
  conversationId?: string;
  tomeProjectSlug?: string;
  tomeSessionId?: string;
  userQuestion?: string | null;
  /** The prompt this turn would resend on retry. */
  retryText?: string | null;
  onOpenPage?: (path: string) => void;
  glossaryPreview?: GlossaryResolver;
  onFeedbackChange?: (id: string, feedback: Feedback) => void;
  onRetry?: (text: string) => void;
  retryDisabled?: boolean;
}) {
  const handleRetry =
    retryText && onRetry ? () => onRetry(retryText) : undefined;
  const handleFeedbackChange = onFeedbackChange
    ? (feedback: Feedback) => onFeedbackChange(msg.id, feedback)
    : undefined;

  if (msg.system) {
    const text = msg.parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {text}
        </span>
      </div>
    );
  }

  const isUser = msg.role === "user";

  if (isUser) {
    const text = msg.parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">
          <span className="selection:bg-primary-foreground selection:text-primary">{text}</span>
        </div>
        <MessageActions
          content={text}
          messageId={msg.id}
          copyLabel="Copy message"
          onRetry={handleRetry}
          retryLabel="Retry this prompt"
          disabled={retryDisabled}
          className="justify-end"
        />
      </div>
    );
  }

  // Assistant: render parts in arrival order — text segments and tool chips
  // interleaved exactly as the stream produced them. Adjacent tool parts
  // collapse into a single group so a burst of tool calls doesn't render as
  // a wall of individual pills.
  const lastTextIdx = msg.parts.reduce(
    (acc, p, i) => (p.kind === "text" ? i : acc),
    -1,
  );
  const lastPart = msg.parts[msg.parts.length - 1];
  const showDots =
    msg.pending && (msg.parts.length === 0 || lastPart?.kind === "tool");
  const groups = groupToolParts(msg.parts);
  const hasText = msg.parts.some((p) => p.kind === "text" && p.text.trim());

  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex max-w-[90%] flex-col gap-2">
        {groups.map((g) =>
          g.kind === "toolGroup" ? (
            <ToolChipGroup key={g.startIndex} parts={g.parts} onOpen={onOpenPage} />
          ) : (
            <div
              key={g.index}
              className="rounded-2xl bg-muted px-4 py-2 text-sm text-foreground"
            >
              <MarkdownRenderer
                content={g.part.text}
                isStreaming={Boolean(msg.pending) && g.index === lastTextIdx}
                variant="final"
                onInternalLink={onOpenPage}
                glossaryPreview={glossaryPreview}
              />
            </div>
          ),
        )}
        {showDots && (
          <div className="rounded-2xl bg-muted px-4 py-2 text-foreground">
            <PendingDots />
          </div>
        )}
        {!msg.pending && hasText && (
          <div className="flex items-center gap-2">
            <MessageActions
              content={textOfParts(msg.parts)}
              messageId={msg.id}
              conversationId={conversationId}
              feedbackSource="tome"
              tomeProjectSlug={tomeProjectSlug}
              tomeSessionId={tomeSessionId}
              tomeUserQuestion={userQuestion ?? undefined}
              tomeAssistantResponse={textOfParts(msg.parts)}
              copyLabel="Copy response"
              onRetry={handleRetry}
              retryLabel="Regenerate response"
              disabled={retryDisabled}
              showFeedback
              feedback={msg.feedback}
              onFeedbackChange={handleFeedbackChange}
            />
            {msg.model && (
              <span
                className="font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                title={`Answered by ${msg.model}${msg.modelProvenance ? ` via ${msg.modelProvenance.source}` : ""}`}
              >
                {msg.model}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function textOfParts(parts: Part[]): string {
  return parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
}

type ToolPart = Extract<Part, { kind: "tool" }>;
type TextPart = Extract<Part, { kind: "text" }>;
type Group =
  | { kind: "text"; part: TextPart; index: number }
  | { kind: "toolGroup"; parts: ToolPart[]; startIndex: number };

function groupToolParts(parts: Part[]): Group[] {
  const groups: Group[] = [];
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (p.kind === "tool") {
      const startIndex = i;
      const run: ToolPart[] = [];
      while (i < parts.length && parts[i].kind === "tool") {
        run.push(parts[i] as ToolPart);
        i++;
      }
      groups.push({ kind: "toolGroup", parts: run, startIndex });
    } else {
      groups.push({ kind: "text", part: p as TextPart, index: i });
      i++;
    }
  }
  return groups;
}

/** A run of adjacent tool calls. Single calls render as a plain chip; runs of
 * two or more collapse into one pill (latest call + count) that expands to
 * the full sequence on click. Collapsed by default on every fresh render. */
function ToolChipGroup({
  parts,
  onOpen,
}: {
  parts: ToolPart[];
  onOpen?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (parts.length === 1) {
    const p = parts[0];
    return <ToolChip label={p.label} path={p.path} onOpen={onOpen} />;
  }

  if (expanded) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        {parts.map((p, i) => (
          <ToolChip key={i} label={p.label} path={p.path} onOpen={onOpen} />
        ))}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Collapse
        </button>
      </div>
    );
  }

  const latest = parts[parts.length - 1];
  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      title={`${parts.length} tool calls — click to expand`}
      className="inline-flex max-w-[280px] items-center gap-1 self-start rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Wrench className="h-3 w-3 shrink-0" />
      <span className="truncate">{latest.label}</span>
      <span className="shrink-0 rounded-full bg-background px-1.5 text-[10px] font-medium">
        {parts.length}
      </span>
    </button>
  );
}

function ToolChip({
  label,
  path,
  onOpen,
}: {
  label: string;
  path?: string;
  onOpen?: (path: string) => void;
}) {
  const clickable = Boolean(path && onOpen);
  const className =
    "inline-flex max-w-[280px] items-center gap-1 self-start rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" +
    (clickable
      ? " cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
      : "");
  const content = (
    <>
      <Wrench className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  if (clickable) {
    return (
      <button
        type="button"
        title={`Open ${path}`}
        onClick={() => onOpen!(path!)}
        className={className}
      >
        {content}
      </button>
    );
  }
  return (
    <span title={label} className={className}>
      {content}
    </span>
  );
}

function PendingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// SSE consumption — parses `event: <type>\ndata: <json>\n\n` frames.
// ---------------------------------------------------------------------------

interface SseHandlers {
  onToken: (text: string) => void;
  onTool: (label: string, path?: string) => void;
  onSession: (id: string) => void;
  onPageWritten: () => void;
  onError: (message: string, code?: string) => void;
  onCompact?: (data: {
    pre_tokens?: number | null;
    post_tokens?: number | null;
    trigger?: string | null;
  }) => void;
  onContextUsage?: (data: { percentage?: number | null }) => void;
  onDone?: (data: {
    model?: string | null;
    modelProvenance?: ModelProvenance | null;
  }) => void;
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  h: SseHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      handleFrame(frame, h);
    }
  }
  if (buf.trim()) handleFrame(buf, h);
}

/**
 * Turn a tool_call event into a readable chip label, e.g. `Read overview.md`,
 * `Glob *.md`, `Grep "auth"`, `github_get_file caipe/ui`. Falls back to the
 * bare tool name when no recognizable argument is present.
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
  // Friendlier tool names (strip MCP prefixes like `mcp__github__`).
  const name = tool.replace(/^mcp__[^_]+__/, "").replace(/^github_/, "gh:");
  const arg = pick(
    "file_path",
    "path",
    "pattern",
    "query",
    "url",
    "repo",
    "prompt",
  );
  if (!arg) return name;
  const short = arg.replace(/^\.\//, "");
  const quoted = /\s/.test(short) ? `"${short}"` : short;
  return `${name} ${quoted}`;
}

function handleFrame(frame: string, h: SseHandlers): void {
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
      if (typeof data.text === "string") h.onToken(data.text);
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
      h.onTool(describeTool(tool, data.input), isPage ? pagePath : undefined);
      // Edit/Write (and the agent's persist hook) mutate wiki pages.
      if (/write|edit/i.test(tool)) h.onPageWritten();
      break;
    }
    case "tool_result":
      break;
    case "session":
      if (typeof data.session_id === "string") h.onSession(data.session_id);
      break;
    case "error":
      h.onError(
        String(data.message ?? "agent error"),
        typeof data.code === "string" ? data.code : undefined,
      );
      break;
    case "compact_boundary":
      h.onCompact?.({
        pre_tokens: typeof data.pre_tokens === "number" ? data.pre_tokens : null,
        post_tokens: typeof data.post_tokens === "number" ? data.post_tokens : null,
        trigger: typeof data.trigger === "string" ? data.trigger : null,
      });
      break;
    case "context_usage":
      h.onContextUsage?.({
        percentage: typeof data.percentage === "number" ? data.percentage : null,
      });
      break;
    case "done":
      h.onDone?.({
        model: typeof data.model === "string" ? data.model : null,
        modelProvenance:
          data.model_provenance && typeof data.model_provenance === "object"
            ? (data.model_provenance as ModelProvenance)
            : null,
      });
      break;
  }
}
