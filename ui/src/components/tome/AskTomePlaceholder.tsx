"use client";

import { Sparkles, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { useTomeAssistantSettings } from "@/hooks/use-tome-assistant-settings";

/**
 * The questions the hub's assistant would be asked, drawn from the ones the
 * real bubble already offers at this altitude.
 */
const PROMPTS = [
  "What projects can I access?",
  "Summarize recent project progress",
  "What changed this week?",
] as const;

/**
 * The shape of the Ask Tome bubble, where the real one is switched off.
 *
 * It answers nothing. It exists so the corner of the page is not empty in a
 * deployment with no assistant configured, and so the arrangement in the
 * design can be seen and agreed on before anything is wired to it.
 *
 * It renders only when the real bubble does not. Two assistants in one
 * corner would sit on top of each other, and one of them would be a lie
 * told next to something that works.
 */
export function AskTomePlaceholder() {
  const settings = useTomeAssistantSettings();
  const [open, setOpen] = React.useState(false);

  if (settings.tome_assistant_popup_enabled) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3">
      {open && (
        <section
          role="dialog"
          aria-label="Ask Tome"
          className="pointer-events-auto w-96 max-w-full rounded-2xl border bg-background p-4 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden />
              Ask Tome
            </h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close Ask Tome"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Disabled rather than merely unwired: a box that takes typing and
              does nothing with it is worse than one that says it is shut. */}
          <input
            type="text"
            disabled
            placeholder="Ask anything about your projects"
            aria-label="Ask anything about your projects"
            className="h-9 w-full rounded-lg border bg-muted/40 px-3 text-sm placeholder:text-muted-foreground"
          />

          <ul className="mt-3 flex flex-wrap gap-1.5">
            {PROMPTS.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  disabled
                  className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {prompt}
                </button>
              </li>
            ))}
          </ul>

          {/* Stronger than muted: at twelve pixels the muted token measures
              4.2:1 on the light theme, under the 4.5:1 that normal text
              needs. The disabled controls above it are exempt under WCAG
              1.4.3 and do read as disabled, which is the point of them; this
              sentence is the one thing here a reader must be able to read. */}
          <p className="mt-3 text-xs leading-relaxed text-foreground/75">
            A preview. No assistant is configured for this deployment yet, so
            nothing here is answered.
          </p>
        </section>
      )}

      <Button
        className="pointer-events-auto gap-2 rounded-full shadow-lg"
        aria-label="Open Ask Tome"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        Ask Tome
      </Button>
    </div>
  );
}
