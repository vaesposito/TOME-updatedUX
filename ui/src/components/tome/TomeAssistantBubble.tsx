"use client";

import { MessageCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AgenticAppAssistantOverlay } from "@/components/agentic-apps/AgenticAppAssistantOverlay";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { validateAssistantContextMessage } from "@/lib/agentic-apps/assistant-context";
import { resolveUsableChatAgent } from "@/lib/chat-agent-selection";

interface Props {
  slug?: string;
  projectTitle?: string;
  pagePath?: string;
}

/** TOME uses GRID conversations; project and page are optional viewing context. */
export function TomeAssistantBubble({ slug, projectTitle, pagePath }: Props) {
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
    async function resolveAgent() {
      try {
        const apps = await apiClient.getAgenticApps();
        const requestedAgentId = apps.items.find((app) => app.appId === "tome")?.assistantAgentId || "agent-tome-agent";
        const agent = await resolveUsableChatAgent({ requestedAgentId, requireAvailableAgent: true });
        if (!cancelled) {
          setAgentId(agent.id);
          setError(null);
        }
      } catch (reason: unknown) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "TOME assistant is unavailable.");
      }
    }
    void resolveAgent();
    return () => { cancelled = true; };
  }, [open, agentId, attempt]);

  if (agentId) {
    return (
      <AgenticAppAssistantOverlay
        appId="tome"
        appName="TOME"
        assistantLabel="Ask Tome"
        assistantAgentName="Tome Assistant"
        assistantAgentId={agentId}
        assistantRuntime="tome-native"
        activeContext={context?.contextId === clearedContextId ? null : context}
        onClearContext={() => setClearedContextId(context?.contextId ?? null)}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3">
      {open && (
        <section role="dialog" aria-label="Tome Assistant" className="pointer-events-auto w-96 max-w-full rounded-2xl border bg-background p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Tome Assistant</h2>
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
