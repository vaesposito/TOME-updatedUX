"use client";

import { Bot, Maximize2, MessageCircle, Minimize2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { ChatPanel } from "@/components/tome/ChatPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GlossaryResolver } from "@/lib/tome/tome-links";

interface Props {
  slug: string;
  projectTitle?: string;
  pagePath?: string;
  onPagesChanged: () => void;
  onOpenPage: (path: string) => void;
  glossaryPreview?: GlossaryResolver;
}

/** Native TOME chat uses the project's existing session and authenticated BFF. */
export function TomeAssistantBubble({
  slug,
  projectTitle,
  pagePath,
  onPagesChanged,
  onOpenPage,
  glossaryPreview,
}: Props) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const panelId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {started && (
        <section
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          hidden={!open}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.stopPropagation();
              close();
            }
          }}
          className={cn(
            "pointer-events-auto flex max-h-[calc(100dvh-7rem)] max-w-full flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl",
            expanded ? "h-[820px] w-[900px]" : "h-[680px] w-[520px]",
            !open && "hidden",
          )}
        >
          <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
            <Bot className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-sm font-semibold">Tome Assistant</h2>
              <p className="truncate text-xs text-muted-foreground">{projectTitle ?? slug}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={expanded ? "Reduce assistant size" : "Expand assistant"}
              aria-pressed={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button ref={closeRef} variant="ghost" size="icon" aria-label="Close Tome Assistant" onClick={close}>
              <X className="h-4 w-4" />
            </Button>
          </header>
          {pagePath && (
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={pagePath}>{pagePath}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPrompt(`Read the project wiki page ${JSON.stringify(pagePath)} and summarize its key points. Cite the page and distinguish recorded facts from gaps.`)}
              >
                Ask about this page
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <ChatPanel
              slug={slug}
              projectTitle={projectTitle}
              onPagesChanged={onPagesChanged}
              onOpenPage={onOpenPage}
              glossaryPreview={glossaryPreview}
              initialPrompt={prompt}
              onInitialPromptConsumed={() => setPrompt(null)}
            />
          </div>
        </section>
      )}
      <Button
        ref={triggerRef}
        aria-label={open ? "Minimize Tome Assistant" : "Open Tome Assistant"}
        aria-expanded={open}
        aria-controls={started ? panelId : undefined}
        className="pointer-events-auto gap-2 rounded-full px-4 py-3 shadow-lg"
        onClick={() => {
          if (open) close();
          else {
            setStarted(true);
            setOpen(true);
          }
        }}
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        Ask Tome
      </Button>
    </div>
  );
}
