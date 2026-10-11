"use client";

import { MessageCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AgenticAppAssistantOverlay } from "@/components/agentic-apps/AgenticAppAssistantOverlay";
import { Button } from "@/components/ui/button";
import { useTomeAssistantSettings } from "@/hooks/use-tome-assistant-settings";
import { validateAssistantContextMessage } from "@/lib/agentic-apps/assistant-context";
import { resolveUsableChatAgent } from "@/lib/chat-agent-selection";

interface Props {
  slug?: string;
  projectTitle?: string;
  pagePath?: string;
  bottomInset?: number;
}

/** TOME uses GRID conversations; project and page are optional viewing context. */
export function TomeAssistantBubble(props: Props) {
  const settings = useTomeAssistantSettings();
  if (!settings.tome_assistant_popup_enabled) return null;
  return <EnabledTomeAssistantBubble key={settings.agent_id} {...props} requestedAgentId={settings.agent_id} />;
}

function EnabledTomeAssistantBubble({ slug, projectTitle, pagePath, bottomInset, requestedAgentId }: Props & { requestedAgentId: string | null }) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearedContextId, setClearedContextId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const context = useMemo(() => {
    const route = slug
      ? `/projects/${encodeURIComponent(slug)}/tome${pagePath ? `/wiki/${pagePath.split("/").map(encodeURIComponent).join("/")}` : ""}`
      : "/projects";
    const result = validateAssistantContextMessage({
      appId: "tome",
      message: {
        type: "caipe.agenticApp.context.v1",
        version: "1.0",
        appId: "tome",
        context: {
          route,
          title: projectTitle || "TOME projects",
          ...(slug ? { resourceRefs: [{ project_slug: slug, ...(pagePath ? { page_path: pagePath } : {}) }] } : {}),
          suggestedPrompts: slug
            ? ["Summarize this project's progress", "What changed recently in this project?"]
            : ["What projects can I access?", "Summarize recent project progress"],
        },
      },
    });
    return result.ok ? result.record : null;
  }, [slug, projectTitle, pagePath]);

  useEffect(() => {
    if (!open || agentId) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setError(null);
    async function resolveAgent() {
      try {
        if (!requestedAgentId) throw new Error("TOME assistant is not configured.");
        const agent = await resolveUsableChatAgent({ requestedAgentId, requireAvailableAgent: true, signal: controller.signal });
        if (!cancelled) {
          setAgentId(agent.id);
          setError(null);
        }
      } catch (reason: unknown) {
        if (!cancelled) setError(controller.signal.aborted
          ? "TOME assistant connection timed out. Please retry."
          : reason instanceof Error ? reason.message : "TOME assistant is unavailable.");
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void resolveAgent();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, agentId, attempt, requestedAgentId]);

  if (agentId) {
    return (
      <AgenticAppAssistantOverlay
        appId="tome"
        appName="TOME"
        assistantLabel="Ask Tome"
        assistantAgentName="Ask Tome"
        assistantAgentId={agentId}
        assistantRuntime="tome-native"
        bottomInset={bottomInset}
        activeContext={context?.contextId === clearedContextId ? null : context}
        onClearContext={() => setClearedContextId(context?.contextId ?? null)}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3" style={{ bottom: bottomInset }}>
      {open && (
        <section role="dialog" aria-label="Ask Tome" className="pointer-events-auto w-96 max-w-full rounded-2xl border bg-background p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Ask Tome</h2>
            <Button variant="ghost" size="icon" aria-label="Close Tome Assistant" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
          </div>
          <p role={error ? "alert" : "status"} className="text-sm text-muted-foreground">{error ?? "Connecting to TOME assistant…"}</p>
          {error && <Button className="mt-3" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Retry</Button>}
        </section>
      )}
      <Button className="pointer-events-auto gap-2 rounded-full" aria-label="Open Tome Assistant" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <MessageCircle className="h-4 w-4" />Ask Tome
      </Button>
    </div>
  );
}
