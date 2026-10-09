"use client";

// assisted-by Codex Codex-sonnet-4-6

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  LoaderCircle,
  Maximize2,
  Minimize2,
  ExternalLink,
  MessageCircle,
  Plus,
  Sparkles,
  Trash2,
  Type,
  X,
} from "lucide-react";

import { useRouter } from "next/navigation";

import { ChatPanel } from "@/components/chat/DynamicAgentChatPanel";
import { buildAssistantClientContext } from "@/lib/agentic-apps/assistant-context";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import type { Conversation } from "@/types/a2a";
import type { AgenticAppAssistantContextRecord } from "@/types/agentic-app";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

const DEFAULT_PANEL_SIZE = { width: 720, height: 780 };
const MIN_PANEL_SIZE = { width: 480, height: 560 };
const MAX_PANEL_SIZE = { width: 1180, height: 940 };
const GLASS_MODE_STORAGE_KEY = "agentic-app-assistant-glass";
const FONT_SCALE_STORAGE_KEY = "agentic-app-assistant-font-scale";
const AGENTIC_APP_CONVERSATION_KIND = "agentic-app";

type AssistantFontScale = "compact" | "default" | "large";

export interface AgenticAppAssistantOverlayProps {
  appId: string;
  appName: string;
  /**
   * Per-app label for the floating bubble button (e.g. "Ask FinOps"). Falls back to "Ask CAIPE".
   * Keep short — ~14 chars max renders cleanly.
   */
  assistantLabel?: string;
  /**
   * Per-app display name shown inside the chat panel header (e.g. "FinOps Assistant").
   * Falls back to "CAIPE assistant for {appName}".
   */
  assistantAgentName?: string;
  activeContext: AgenticAppAssistantContextRecord | null;
  onClearContext: () => void;
  assistantAgentId: string;
  assistantRuntime?: "tome-native";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgenticAppAssistantOverlay({
  appId,
  appName,
  assistantLabel,
  assistantAgentName,
  activeContext,
  onClearContext,
  assistantAgentId,
  assistantRuntime,
  open,
  onOpenChange,
}: AgenticAppAssistantOverlayProps) {
  const bubbleLabel = (assistantLabel?.trim() || "Ask CAIPE").slice(0, 32);
  const headerTitle = (assistantAgentName?.trim() || `CAIPE assistant for ${appName}`).slice(0, 64);
  const chatPanelAgentName = (assistantAgentName?.trim() || "CAIPE Assistant").slice(0, 64);
  // AgenticAppShell resolves the executable agent ID. The overlay needs only
  // the manifest-controlled display name because ChatPanel treats the agent
  // object as optional presentation metadata.
  // assisted-by claude code claude-opus-4-8
  const chatPanelAgent = useMemo(
    () => ({ name: chatPanelAgentName }) as DynamicAgentConfig,
    [chatPanelAgentName],
  );
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [panelSize, setPanelSize] = useState(DEFAULT_PANEL_SIZE);
  const [glassMode, setGlassMode] = useState(readStoredGlassMode);
  const [fontScale, setFontScale] = useState<AssistantFontScale>(readStoredFontScale);
  const [assistantConversation, setAssistantConversation] = useState<{
    agentId: string;
    id: string;
  } | null>(null);
  const [conversationError, setConversationError] = useState<{
    agentId: string;
    message: string;
  } | null>(null);
  const [conversationActionPending, setConversationActionPending] = useState(false);
  const previousActiveConversationRef = useRef<string | null | undefined>(undefined);
  const conversationRequestRef = useRef<{
    key: string;
    promise: Promise<string>;
  } | null>(null);
  const createConversation = useChatStore((state) => state.createConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const loadConversationsFromServer = useChatStore(
    (state) => state.loadConversationsFromServer,
  );
  const loadMessagesFromServer = useChatStore((state) => state.loadMessagesFromServer);
  const setActiveConversation = useChatStore((state) => state.setActiveConversation);
  const conversationKey = `${appId}:${assistantAgentId}`;
  const conversationTitle = `${appName} Assistant`.slice(0, 120);
  const conversationMetadata = useMemo(
    () => ({
      conversation_surface: AGENTIC_APP_CONVERSATION_KIND,
      agentic_app_id: appId,
      agentic_app_agent_id: assistantAgentId,
    }),
    [appId, assistantAgentId],
  );
  const clientContext = useMemo(() => buildAssistantClientContext(activeContext), [activeContext]);
  const suggestedPrompts = activeContext?.suggestedPrompts?.length
    ? activeContext.suggestedPrompts
    : [`Summarize what I am viewing in ${appName}`];

  useEffect(() => {
    writeStoredGlassMode(glassMode);
  }, [glassMode]);

  useEffect(() => {
    writeStoredFontScale(fontScale);
  }, [fontScale]);

  useEffect(() => {
    if (!open) return;
    previousActiveConversationRef.current = useChatStore.getState().activeConversationId;
    return () => {
      setActiveConversation(previousActiveConversationRef.current ?? null);
      previousActiveConversationRef.current = undefined;
    };
  }, [open, setActiveConversation]);

  const createAppConversation = useCallback(
    () =>
      createConversation(assistantAgentId, {
        title: conversationTitle,
        metadata: conversationMetadata,
      }),
    [assistantAgentId, conversationMetadata, conversationTitle, createConversation],
  );

  const findOrCreateAppConversation = useCallback(async (): Promise<string> => {
    await loadConversationsFromServer();
    const existing = findLatestAppConversation(
      useChatStore.getState().conversations,
      appId,
      assistantAgentId,
      assistantRuntime,
    );
    if (!existing) return createAppConversation();

    setActiveConversation(existing.id);
    await loadMessagesFromServer(existing.id);
    return existing.id;
  }, [
    appId,
    assistantAgentId,
    assistantRuntime,
    createAppConversation,
    loadConversationsFromServer,
    loadMessagesFromServer,
    setActiveConversation,
  ]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const previousActiveConversation = previousActiveConversationRef.current ?? null;

    if (assistantConversation?.agentId === assistantAgentId) {
      setActiveConversation(assistantConversation.id);
      return () => {
        cancelled = true;
      };
    }

    let request = conversationRequestRef.current;
    if (!request || request.key !== conversationKey) {
      request = {
        key: conversationKey,
        promise: findOrCreateAppConversation(),
      };
      conversationRequestRef.current = request;
    }

    request.promise
      .then((id) => {
        if (cancelled) {
          setActiveConversation(previousActiveConversation);
          return;
        }
        setAssistantConversation({ agentId: assistantAgentId, id });
        setActiveConversation(id);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setConversationError({
            agentId: assistantAgentId,
            message: error instanceof Error ? error.message : "Could not start assistant chat",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    assistantAgentId,
    assistantConversation,
    conversationKey,
    findOrCreateAppConversation,
    open,
    setActiveConversation,
  ]);

  const handleNewChat = useCallback(async (): Promise<void> => {
    if (conversationActionPending) return;
    setConversationActionPending(true);
    setConversationError(null);
    try {
      const id = await createAppConversation();
      conversationRequestRef.current = { key: conversationKey, promise: Promise.resolve(id) };
      setAssistantConversation({ agentId: assistantAgentId, id });
      setActiveConversation(id);
    } catch (error: unknown) {
      setConversationError({
        agentId: assistantAgentId,
        message: error instanceof Error ? error.message : "Could not start a new chat",
      });
    } finally {
      setConversationActionPending(false);
    }
  }, [
    assistantAgentId,
    conversationActionPending,
    conversationKey,
    createAppConversation,
    setActiveConversation,
  ]);

  const handleClearChat = useCallback(async (): Promise<void> => {
    if (!assistantConversation || conversationActionPending) return;
    if (
      !window.confirm(
        "Clear this chat? The current conversation will move to Trash and a new chat will start.",
      )
    ) {
      return;
    }

    setConversationActionPending(true);
    setConversationError(null);
    try {
      await deleteConversation(assistantConversation.id);
      const id = await createAppConversation();
      conversationRequestRef.current = { key: conversationKey, promise: Promise.resolve(id) };
      setAssistantConversation({ agentId: assistantAgentId, id });
      setActiveConversation(id);
    } catch (error: unknown) {
      setConversationError({
        agentId: assistantAgentId,
        message: error instanceof Error ? error.message : "Could not clear this chat",
      });
    } finally {
      setConversationActionPending(false);
    }
  }, [
    assistantAgentId,
    assistantConversation,
    conversationActionPending,
    conversationKey,
    createAppConversation,
    deleteConversation,
    setActiveConversation,
  ]);

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const startPoint = clientPoint(event);
      const startSize = panelSize;
      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";

      function handlePointerMove(moveEvent: PointerEvent) {
        const nextPoint = clientPoint(moveEvent);
        setPanelSize(
          clampPanelSize({
            width: startSize.width + (startPoint.x - nextPoint.x),
            height: startSize.height + (startPoint.y - nextPoint.y),
          }),
        );
      }

      function handlePointerUp() {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      }

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [panelSize],
  );

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
      {open ? (
        <section
          aria-label={headerTitle}
          className={cn(
            "pointer-events-auto relative flex flex-col overflow-hidden rounded-3xl border border-border bg-popover shadow-2xl transition-colors",
            glassMode
              ? "bg-popover/80 shadow-[0_24px_60px_rgba(15,23,42,0.12)] ring-1 ring-cyan-500/25 backdrop-blur-3xl backdrop-saturate-200 dark:border-cyan-200/55 dark:bg-cyan-950/15 dark:shadow-[0_24px_120px_rgba(34,211,238,0.22),inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_64px_rgba(34,211,238,0.10)] dark:ring-cyan-200/45"
              : "shadow-black/10 dark:border-cyan-300/20 dark:bg-slate-950/95 dark:shadow-cyan-950/40",
          )}
          style={{
            width: expanded ? "calc(100vw - 3rem)" : `min(${panelSize.width}px, calc(100vw - 2rem))`,
            height: expanded ? "calc(100dvh - 7rem)" : `min(${panelSize.height}px, calc(100vh - 7rem))`,
          }}
        >
          <button
            type="button"
            aria-label={`Resize ${headerTitle}`}
            onPointerDown={handleResizeStart}
            className="absolute left-3 top-3 z-10 flex h-10 w-10 cursor-nwse-resize touch-none items-center justify-center rounded-full border border-border bg-background/60 shadow-lg backdrop-blur-md transition hover:border-cyan-500/50 hover:bg-cyan-500/10 dark:border-cyan-200/30 dark:bg-slate-950/35 dark:shadow-cyan-950/30 dark:hover:border-cyan-200/60 dark:hover:bg-cyan-300/10"
          >
            <span className="absolute h-7 w-7 rounded-full border border-cyan-600/30 dark:border-cyan-200/30" aria-hidden />
            <span className="absolute h-4 w-4 rounded-full border border-cyan-600/40 dark:border-cyan-300/40" aria-hidden />
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-600 shadow-[0_0_14px_rgba(34,211,238,0.5)] dark:bg-cyan-200 dark:shadow-[0_0_14px_rgba(34,211,238,0.8)]" aria-hidden />
          </button>
          <header
            className={cn(
              "flex items-center justify-between gap-3 border-b border-border py-3 pl-16 pr-4",
              glassMode ? "bg-popover/40 backdrop-blur-3xl dark:bg-cyan-950/30" : "dark:bg-white/[0.02]",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-full bg-cyan-500/10 p-2 text-cyan-700 dark:bg-cyan-300/15 dark:text-cyan-100">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">{headerTitle}</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {activeContext ? `${activeContext.route} context active` : `Waiting for ${appId} context`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={expanded ? "Reduce assistant size" : "Expand assistant"}
                aria-pressed={expanded}
                onClick={() => setExpanded((value) => !value)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                aria-label="Open conversation in regular chat"
                disabled={!assistantConversation}
                onClick={() => {
                  if (!assistantConversation) return;
                  previousActiveConversationRef.current = assistantConversation.id;
                  setActiveConversation(assistantConversation.id);
                  router.push(`/chat/${encodeURIComponent(assistantConversation.id)}`);
                }}
                className="rounded-full p-2 text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Start new assistant chat"
                title="New chat"
                disabled={conversationActionPending}
                onClick={() => void handleNewChat()}
                className="rounded-full p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
              >
                {conversationActionPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
              </button>
              <button
                type="button"
                aria-label="Clear assistant chat"
                title="Clear chat"
                disabled={!assistantConversation || conversationActionPending}
                onClick={() => void handleClearChat()}
                className="rounded-full p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Assistant font size ${fontScale}`}
                onClick={() => setFontScale((value) => nextFontScale(value))}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground dark:border-white/10 dark:bg-slate-950/40"
              >
                <Type className="h-3.5 w-3.5" aria-hidden />
                {fontScaleLabel(fontScale)}
              </button>
              <button
                type="button"
                aria-label={
                  glassMode
                    ? "Disable translucent assistant mode"
                    : "Enable translucent assistant mode"
                }
                aria-pressed={glassMode}
                onClick={() => setGlassMode((value) => !value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition",
                  glassMode
                    ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-800 shadow-[0_0_12px_rgba(34,211,238,0.18)] dark:border-cyan-200/70 dark:bg-cyan-300/25 dark:text-cyan-50 dark:shadow-[0_0_24px_rgba(34,211,238,0.25)]"
                    : "border-border bg-background/40 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-300 dark:hover:text-white",
                )}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Glass
              </button>
              <button
                type="button"
                className="rounded-full p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label="Close assistant"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </header>

          <div className={cn(
            "border-b border-border px-4 py-3 text-xs text-muted-foreground",
            glassMode ? "bg-cyan-500/5 backdrop-blur-2xl dark:bg-cyan-300/15" : "dark:bg-white/[0.03]",
          )}>
            {activeContext ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-cyan-700 dark:text-cyan-100">
                    {activeContext.title ?? "Published app context"}
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-accent dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
                    onClick={onClearContext}
                  >
                    Clear context
                  </button>
                </div>
                {activeContext.summary ? <p className="line-clamp-2 text-muted-foreground">{activeContext.summary}</p> : null}
              </div>
            ) : (
              <p>External apps can publish bounded page context. CAIPE treats it as untrusted data, not instructions.</p>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {assistantConversation?.agentId === assistantAgentId ? (
              <ChatPanel
                key={assistantConversation.id}
                conversationId={assistantConversation.id}
                agentId={assistantAgentId}
                agent={chatPanelAgent}
                clientContext={clientContext}
                suggestedPrompts={suggestedPrompts}
                suggestedPromptsInitiallyHidden={false}
                emptyStateTitle={`Ask about ${appName}`}
                emptyStateSubtitle="The accepted app context is attached as structured metadata."
                surface={glassMode ? "glass" : "default"}
                fontScale={fontScale}
              />
            ) : conversationError?.agentId === assistantAgentId ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">
                {conversationError.message}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                Starting {bubbleLabel}…
              </div>
            )}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        aria-label={`Open ${bubbleLabel}`}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200"
        onClick={() => onOpenChange(!open)}
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        {bubbleLabel}
        {activeContext ? <span className="rounded-full bg-slate-950/15 px-2 py-0.5 text-xs">context</span> : null}
      </button>
    </div>
  );
}

function clientPoint(event: PointerEvent | React.PointerEvent): { x: number; y: number } {
  return { x: event.clientX, y: event.clientY };
}

function findLatestAppConversation(
  conversations: Conversation[],
  appId: string,
  agentId: string,
  runtime?: "tome-native",
): Conversation | null {
  return conversations.reduce<Conversation | null>((latest, conversation) => {
    const metadata = conversation.metadata;
    if (
      metadata?.conversation_surface !== AGENTIC_APP_CONVERSATION_KIND
      || metadata.agentic_app_id !== appId
      || metadata.agentic_app_agent_id !== agentId
      || metadata.assistant_runtime !== runtime
    ) {
      return latest;
    }
    return !latest || conversation.updatedAt > latest.updatedAt ? conversation : latest;
  }, null);
}

function clampPanelSize(size: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.max(MIN_PANEL_SIZE.width, Math.min(MAX_PANEL_SIZE.width, size.width)),
    height: Math.max(MIN_PANEL_SIZE.height, Math.min(MAX_PANEL_SIZE.height, size.height)),
  };
}

function nextFontScale(scale: AssistantFontScale): AssistantFontScale {
  if (scale === "compact") return "default";
  if (scale === "default") return "large";
  return "compact";
}

function fontScaleLabel(scale: AssistantFontScale): string {
  if (scale === "compact") return "Small";
  if (scale === "large") return "Large";
  return "Default";
}

function readStoredGlassMode(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(GLASS_MODE_STORAGE_KEY);
  return raw === null ? true : raw === "true";
}

function writeStoredGlassMode(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GLASS_MODE_STORAGE_KEY, String(value));
}

function readStoredFontScale(): AssistantFontScale {
  if (typeof window === "undefined") return "compact";
  const raw = window.localStorage.getItem(FONT_SCALE_STORAGE_KEY);
  if (raw === "default" || raw === "large") return raw;
  return "compact";
}

function writeStoredFontScale(value: AssistantFontScale): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, value);
}
