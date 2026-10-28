"use client";

import {
  Bot,
  Copy,
  ExternalLink,
  Maximize2,
  Minimize2,
  MessageCircle,
  Paperclip,
  Plus,
  RotateCcw,
  SendHorizonal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  User,
  X,
} from "lucide-react";
import * as React from "react";

import { AuditNotice } from "@/components/chat/AuditNotice";
import { useTomeAssistantSettings } from "@/hooks/use-tome-assistant-settings";
import { cn } from "@/lib/utils";

/** The real panel's own figures, so the stand-in takes up the same room. */
const DEFAULT_PANEL_SIZE = { width: 720, height: 780 };
const MIN_PANEL_SIZE = { width: 480, height: 560 };
const MAX_PANEL_SIZE = { width: 1180, height: 940 };

type AskTomeTab = "chat" | "history" | "scheduled";

/**
 * The tabs, as drawn.
 *
 * Scheduled is struck through in the design: it is where scheduled questions
 * would go, and there is nothing behind it yet. Shown and disabled rather
 * than left out, because the row is part of what is being agreed on.
 */
const TABS: readonly { id: AskTomeTab; label: string; ready: boolean }[] = [
  { id: "chat", label: "Chat", ready: true },
  { id: "history", label: "History", ready: true },
  { id: "scheduled", label: "Scheduled", ready: false },
];

/**
 * A fixed exchange rather than a generated one.
 *
 * Nothing here is answered, so a timestamp from the clock would be a claim
 * that something just happened, and would differ between the server's render
 * and the browser's.
 */
const TRANSCRIPT = [
  {
    id: "turn-1",
    from: "user" as const,
    at: "19 Oct 2026 18:30",
    body: "What changed across my projects this week?",
  },
  {
    id: "turn-2",
    from: "agent" as const,
    at: "19 Oct 2026 18:30",
    body:
      "Three spaces were updated. Two pages were rewritten after the last ingest, one decision is waiting on a reviewer, and nothing is overdue.",
  },
] as const;

/** Past conversations, for the History tab. Titles only, as in the design. */
const HISTORY = [
  { id: "h-1", title: "What changed across my projects this week?", at: "19 Oct 2026" },
  { id: "h-2", title: "Which pages has nobody read?", at: "14 Oct 2026" },
  { id: "h-3", title: "Summarize the open decisions", at: "2 Oct 2026" },
] as const;

/**
 * The shape of the Ask Tome panel, where the real one is switched off.
 *
 * It answers nothing. It exists so the corner of the page is not empty in a
 * deployment with no assistant configured, and so the arrangement can be seen
 * and agreed on before anything is wired to it. The chrome is the real
 * panel's — the same launcher, header, controls and footer — so what is being
 * judged here is the part that is new: the tabs, and a turn of conversation
 * with its actions under it.
 *
 * It renders only when the real panel does not. Two assistants in one corner
 * would sit on top of each other, and one of them would be a lie told next to
 * something that works.
 */
export function AskTomePlaceholder() {
  const settings = useTomeAssistantSettings();
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<AskTomeTab>("chat");
  const [expanded, setExpanded] = React.useState(false);
  const [panelSize, setPanelSize] = React.useState(DEFAULT_PANEL_SIZE);

  // Dragged from the corner handle, exactly as the real panel is: the design
  // asks for a resizable panel, and a handle that does not move is a worse
  // answer to that than no handle at all.
  const startResize = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY };
      const startSize = panelSize;
      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";

      function onMove(move: PointerEvent) {
        setPanelSize({
          width: clamp(
            startSize.width + (start.x - move.clientX),
            MIN_PANEL_SIZE.width,
            MAX_PANEL_SIZE.width,
          ),
          height: clamp(
            startSize.height + (start.y - move.clientY),
            MIN_PANEL_SIZE.height,
            MAX_PANEL_SIZE.height,
          ),
        });
      }

      function onUp() {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelSize],
  );

  if (settings.tome_assistant_popup_enabled) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 top-18 z-40 flex flex-col items-end justify-end gap-3 sm:inset-x-6 sm:bottom-6">
      {open && (
        <section
          role="dialog"
          aria-label="Ask Tome"
          className="pointer-events-auto relative flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border bg-popover/80 shadow-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] ring-1 ring-cyan-500/25 backdrop-blur-3xl backdrop-saturate-200 dark:border-cyan-200/55 dark:bg-cyan-950/15 dark:ring-cyan-200/45"
          style={{
            width: expanded ? "100%" : `min(${panelSize.width}px, 100%)`,
            height: expanded ? "100%" : `min(${panelSize.height}px, 100%)`,
          }}
        >
          <button
            type="button"
            aria-label="Resize Ask Tome"
            onPointerDown={startResize}
            className="absolute left-3 top-3 z-10 flex h-10 w-10 cursor-nwse-resize touch-none items-center justify-center rounded-full border border-border bg-background/60 shadow-lg backdrop-blur-md transition hover:border-cyan-500/50 hover:bg-cyan-500/10 dark:border-cyan-200/30 dark:bg-slate-950/35 dark:hover:border-cyan-200/60 dark:hover:bg-cyan-300/10"
          >
            <span className="absolute h-7 w-7 rounded-full border border-cyan-600/30 dark:border-cyan-200/30" aria-hidden />
            <span className="absolute h-4 w-4 rounded-full border border-cyan-600/40 dark:border-cyan-300/40" aria-hidden />
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-600 shadow-[0_0_14px_rgba(34,211,238,0.5)] dark:bg-cyan-200" aria-hidden />
          </button>

          <header className="flex items-center justify-between gap-3 border-b border-border bg-popover/40 py-3 pl-16 pr-4 backdrop-blur-3xl dark:bg-cyan-950/30">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-full bg-cyan-500/10 p-2 text-cyan-700 dark:bg-cyan-300/15 dark:text-cyan-100">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="truncate text-sm font-semibold text-foreground">Ask Tome</h2>
            </div>
            <div className="flex items-center gap-2">
              <HeaderButton
                label={expanded ? "Reduce Ask Tome" : "Expand Ask Tome"}
                pressed={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </HeaderButton>
              {/* Shut, not merely unwired. The design has this opening the
                  same question in the chat space; there is no conversation
                  here to carry over, and a button that looks live and does
                  nothing is worse than one that says it is shut. */}
              <HeaderButton label="Open Ask Tome in the chat space" disabled>
                <ExternalLink className="h-4 w-4" />
              </HeaderButton>
              <HeaderButton label="Start a new Ask Tome chat" disabled>
                <Plus className="h-4 w-4" />
              </HeaderButton>
              <HeaderButton label="Clear this Ask Tome chat" disabled>
                <Trash2 className="h-4 w-4" />
              </HeaderButton>
              <HeaderButton label="Close Ask Tome" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </HeaderButton>
            </div>
          </header>

          <div
            role="tablist"
            aria-label="Ask Tome sections"
            className="flex items-center gap-4 border-b border-border px-4"
          >
            {TABS.map(({ id, label, ready }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`ask-tome-tab-${id}`}
                aria-controls={`ask-tome-panel-${id}`}
                aria-selected={tab === id}
                disabled={!ready}
                onClick={() => setTab(id)}
                className={cn(
                  "-mb-px border-b-2 border-transparent py-2.5 text-sm transition-colors",
                  !ready && "line-through",
                  tab === id
                    ? "border-cyan-500 font-semibold text-foreground dark:border-cyan-300"
                    : "font-medium text-muted-foreground enabled:hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* The band the real panel keeps for context, saying the one thing
              a reader has to know before reading a conversation that looks
              like one. Here rather than in the footer, which is below the
              transcript and after the damage.

              Stronger than muted: at twelve pixels the muted token measures
              4.2:1 on the light theme, under the 4.5:1 that normal text
              needs. The shut controls around it are exempt under WCAG 1.4.3
              and do read as shut, which is the point of them; this sentence
              is the one thing here a reader must be able to read. */}
          <p className="border-b border-border px-4 py-3 text-xs text-foreground/75 dark:bg-white/[0.03]">
            A preview. No assistant is configured here yet, so nothing below is
            answered and nothing typed is kept.
          </p>

          <div
            role="tabpanel"
            id={`ask-tome-panel-${tab}`}
            aria-labelledby={`ask-tome-tab-${tab}`}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          >
            {tab === "chat" ? (
              <ol className="space-y-6">
                {TRANSCRIPT.map((turn) => (
                  <Turn key={turn.id} turn={turn} />
                ))}
              </ol>
            ) : (
              <ol className="divide-y divide-border/60">
                {HISTORY.map((entry) => (
                  <li key={entry.id} className="flex items-baseline gap-3 py-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {entry.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{entry.at}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="border-t border-border px-4 pb-3 pt-3">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-background/60 px-3 py-2">
              <input
                type="text"
                disabled
                placeholder="Ask Tome..."
                aria-label="Ask Tome a question"
                className="h-7 min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
              />
              <HeaderButton label="Attach a file" disabled>
                <Paperclip className="h-4 w-4" />
              </HeaderButton>
              <button
                type="button"
                disabled
                aria-label="Send"
                className="rounded-full bg-cyan-300 p-2 text-slate-950 disabled:opacity-50"
              >
                <SendHorizonal className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="mt-1.5 text-center text-xs text-foreground/75">
              <AuditNotice />
            </p>
          </div>
        </section>
      )}

      <button
        type="button"
        aria-label="Open Ask Tome"
        aria-expanded={open}
        className="pointer-events-auto inline-flex shrink-0 items-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200"
        onClick={() => setOpen((value) => !value)}
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        Ask Tome
      </button>
    </div>
  );
}

/** One turn: who said it, when, and the row of actions the design puts under it. */
function Turn({ turn }: { turn: (typeof TRANSCRIPT)[number] }) {
  const mine = turn.from === "user";
  return (
    <li className={cn("flex flex-col gap-2", mine && "items-end")}>
      <div
        className={cn(
          "max-w-[85%] px-4 py-3",
          mine
            ? "rounded-xl rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-xl rounded-tl-sm border border-border/50 bg-card/50",
        )}
      >
        <p
          className={cn(
            "mb-1 text-right text-[11px]",
            mine ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {turn.at}
        </p>
        <p className="text-sm leading-relaxed">{turn.body}</p>
      </div>

      <div className={cn("flex items-center gap-3", mine && "flex-row-reverse")}>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
          aria-hidden
        >
          {mine ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </span>
        <div className="flex items-center gap-1">
          {/* Rating and reporting belong to the answer, not to the question a
              reader wrote themselves; the rest is offered on both turns. */}
          <TurnAction label="Retry"><RotateCcw className="h-3.5 w-3.5" /></TurnAction>
          <TurnAction label="Copy"><Copy className="h-3.5 w-3.5" /></TurnAction>
          {!mine && (
            <>
              <TurnAction label="Good answer"><ThumbsUp className="h-3.5 w-3.5" /></TurnAction>
              <TurnAction label="Bad answer"><ThumbsDown className="h-3.5 w-3.5" /></TurnAction>
              <TurnAction label="Report"><TriangleAlert className="h-3.5 w-3.5" /></TurnAction>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function TurnAction({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      aria-label={label}
      className="rounded-md p-1.5 text-muted-foreground"
    >
      {children}
    </button>
  );
}

function HeaderButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="rounded-full p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
