"use client";

import { ArrowUp, Sparkles } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";

/**
 * The way in to the agent, at the top of a project's home page.
 *
 * A box rather than a link: the question a reader arrives with is the thing
 * they want to type, and making them open a chat first and then remember it
 * is a step that earns nothing. What they type is carried into the agent and
 * sent there, so this is the same conversation either way.
 */

/**
 * Openers offered to someone with no question of their own yet.
 *
 * Each asks about the space as a whole rather than about any one page, since
 * that is what the agent can answer about a project it has ingested, and
 * none names a project — the home page already says which one this is.
 */
const OPENERS: readonly string[] = [
  "What changed this week?",
  "What is blocking us?",
  "Summarise the roadmap",
];

export function HomeAskAgent({
  title,
  onAsk,
}: {
  /** The space being asked about, named in the prompt. */
  title: string;
  onAsk: (question: string) => void;
}) {
  const [question, setQuestion] = React.useState("");
  const field = React.useRef<HTMLTextAreaElement>(null);

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) onAsk(trimmed);
  };

  return (
    // Tinted, and the only thing on the page that is: a reader arriving with
    // a question should find the box before they find the cards.
    <section className="rounded-lg border bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
        className="flex flex-col gap-2"
      >
        <label
          htmlFor="home-ask-agent"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          Ask the agent
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="home-ask-agent"
            ref={field}
            rows={1}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, as it does in the chat this opens. A newline is
              // still available on Shift, for a question worth a paragraph.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask(question);
              }
            }}
            placeholder={`Ask anything about ${title}`}
            className="min-h-9 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            size="sm"
            disabled={question.trim() === ""}
            className="h-9 shrink-0 gap-1.5"
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
            Ask
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {OPENERS.map((opener) => (
            <button
              key={opener}
              type="button"
              // Fills the box rather than sending, so an opener can be
              // adjusted before it goes — it is a starting point, and the
              // reader usually has a particular week or blocker in mind.
              onClick={() => {
                setQuestion(opener);
                field.current?.focus();
              }}
              className="rounded-full border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
            >
              {opener}
            </button>
          ))}
        </div>
      </form>
    </section>
  );
}
