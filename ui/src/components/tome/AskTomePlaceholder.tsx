"use client";

import {
  Bot,
  Copy,
  ExternalLink,
  GripVertical,
  Maximize2,
  Minimize2,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Plus,
  RotateCcw,
  SendHorizonal,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { AuditNotice } from "@/components/chat/AuditNotice";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTomeAssistantSettings } from "@/hooks/use-tome-assistant-settings";
import { cn } from "@/lib/utils";
import {
  ASK_TOME_DEFAULT_SIZE,
  ASK_TOME_MAX_SIZE,
  ASK_TOME_MIN_SIZE,
  useAskTomeStore,
  type AskTomeTab,
} from "@/store/ask-tome-store";

/** The Webex note's width, needed to keep it inside the window as it moves. */
const WEBEX_HELP_WIDTH = 272;

/**
 * How far down the note may be dragged, at the least.
 *
 * The same inset the panel itself keeps, and for the same reason: the app's
 * own header sits above this line and takes the clicks of anything that slides
 * under it, so a note dragged into the top corner would be a note that can no
 * longer be closed.
 */
const WEBEX_HELP_TOP_PX = 72;

/** The tabs, as drawn. */
const TABS: readonly { id: AskTomeTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "history", label: "History" },
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
 * something that works. It is mounted where the real one is mounted, and
 * nowhere else, for the same reason: a stand-in that turned up in a corner
 * the real thing never occupies would be standing in for nothing.
 *
 * What it is doing is kept in a store rather than here, so that following a
 * link from the hub into a space — which takes this component down and puts
 * another up — leaves the panel open, on the same tab, at the same size.
 */
export function AskTomePlaceholder({
  /**
   * Room to leave at the foot of the page, for a surface with something of
   * its own down there — the settings view's Save bar, say. The real panel
   * takes the same measurement.
   */
  bottomInset,
}: {
  bottomInset?: number;
} = {}) {
  const settings = useTomeAssistantSettings();
  const open = useAskTomeStore((state) => state.open);
  const setOpen = useAskTomeStore((state) => state.setOpen);
  const tab = useAskTomeStore((state) => state.tab);
  const setTab = useAskTomeStore((state) => state.setTab);
  const expanded = useAskTomeStore((state) => state.expanded);
  const setExpanded = useAskTomeStore((state) => state.setExpanded);
  const panelSize = useAskTomeStore((state) => state.size);
  const setPanelSize = useAskTomeStore((state) => state.setSize);
  // Not in the store: a menu left hanging open across a navigation would be a
  // menu the reader did not ask for.
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [webexHelpOpen, setWebexHelpOpen] = React.useState(false);
  // Null until it is opened, when it is placed under its own button. Held in
  // viewport coordinates because the note is dragged clear of the panel.
  const [webexHelpAt, setWebexHelpAt] = React.useState<{ x: number; y: number } | null>(null);
  const webexButtonRef = React.useRef<HTMLButtonElement>(null);

  const openWebexHelp = React.useCallback(() => {
    const rect = webexButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setWebexHelpAt({
        // Hung under the button and pulled back inside the right edge, since
        // the button sits near it.
        x: clamp(rect.right - WEBEX_HELP_WIDTH, 16, window.innerWidth - WEBEX_HELP_WIDTH - 16),
        y: Math.max(WEBEX_HELP_TOP_PX, rect.bottom + 10),
      });
    }
    setWebexHelpOpen(true);
  }, []);

  const closeWebexHelp = React.useCallback(() => setWebexHelpOpen(false), []);

  /** Dragged by its own top row, and kept inside the window. */
  const startWebexHelpDrag = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!webexHelpAt) return;
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY };
      const from = webexHelpAt;
      document.body.style.userSelect = "none";

      function onMove(move: PointerEvent) {
        setWebexHelpAt({
          x: clamp(
            from.x + (move.clientX - start.x),
            8,
            Math.max(8, window.innerWidth - WEBEX_HELP_WIDTH - 8),
          ),
          y: clamp(
            from.y + (move.clientY - start.y),
            WEBEX_HELP_TOP_PX,
            Math.max(WEBEX_HELP_TOP_PX, window.innerHeight - 80),
          ),
        });
      }

      function onUp() {
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [webexHelpAt],
  );

  /**
   * Dragged from the panel's own edges, which is what the design asks for:
   * the pointer changes over a border and the border moves.
   *
   * The panel is pinned to the bottom-right, so it is the top and left edges
   * that are free to move, and dragging them away from the corner makes it
   * bigger. There is no visible grip: a reader finds this the way they find
   * the edge of a window, and the one that was there sat over the panel's own
   * header like something spilled on it.
   */
  const startResize = React.useCallback(
    (edge: "left" | "top" | "corner") => (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY };
      const startSize = panelSize;
      document.body.style.userSelect = "none";

      function onMove(move: PointerEvent) {
        setPanelSize({
          width: edge === "top"
            ? startSize.width
            : clamp(
              startSize.width + (start.x - move.clientX),
              ASK_TOME_MIN_SIZE.width,
              ASK_TOME_MAX_SIZE.width,
            ),
          height: edge === "left"
            ? startSize.height
            : clamp(
              startSize.height + (start.y - move.clientY),
              ASK_TOME_MIN_SIZE.height,
              ASK_TOME_MAX_SIZE.height,
            ),
        });
      }

      function onUp() {
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelSize, setPanelSize],
  );

  if (settings.tome_assistant_popup_enabled) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 top-18 z-40 flex flex-col items-end justify-end gap-3 sm:inset-x-6 sm:bottom-6"
      style={{ bottom: bottomInset }}
    >
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
          {/* The edges, as grips. Nothing to see: the cursor over a border is
              the whole affordance, the way it is on a window. Not while
              expanded, when the panel fills the page and has no edge of its
              own to pull. A reader on a keyboard resizes with Expand, which
              is a button in the header.

              The corner grip is larger than it looks because the panel's own
              rounding clips it to the curve, leaving only the part of the
              square that falls inside. */}
          {!expanded && (
            <>
              <span
                aria-hidden
                onPointerDown={startResize("left")}
                className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none"
              />
              <span
                aria-hidden
                onPointerDown={startResize("top")}
                className="absolute inset-x-0 top-0 z-10 h-2 cursor-ns-resize touch-none"
              />
              <span
                aria-hidden
                onPointerDown={startResize("corner")}
                className="absolute left-0 top-0 z-20 h-6 w-6 cursor-nwse-resize touch-none"
              />
            </>
          )}

          <header className="flex items-center justify-between gap-3 border-b border-border bg-popover/40 py-3 pl-4 pr-4 backdrop-blur-3xl dark:bg-cyan-950/30">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-full bg-cyan-500/10 p-2 text-cyan-700 dark:bg-cyan-300/15 dark:text-cyan-100">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="truncate text-sm font-semibold text-foreground">Ask Tome</h2>
            </div>
            {/* Three controls, as the real panel carries: the overflow menu,
                the way out to the chat space, and close. Everything that acts
                on the chat itself lives in the menu rather than spread across
                the header. */}
            <div className="flex items-center gap-2">
              <button
                ref={webexButtonRef}
                type="button"
                aria-expanded={webexHelpOpen}
                onClick={() => (webexHelpOpen ? closeWebexHelp() : openWebexHelp())}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-cyan-500/50 hover:bg-cyan-500/10 hover:text-foreground dark:border-cyan-200/30 dark:hover:border-cyan-200/60",
                  // Held down while its note is out, so the note and the
                  // button it came from read as the same thing.
                  webexHelpOpen &&
                    "border-cyan-500/50 bg-cyan-500/10 text-foreground dark:border-cyan-200/60",
                )}
              >
                <ProviderLogo provider="webex" className="h-3.5 w-3.5 shrink-0 object-contain" />
                Configure Webex
              </button>
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <HeaderButton label="Ask Tome options" pressed={menuOpen}>
                    <MoreVertical className="h-4 w-4" />
                  </HeaderButton>
                </PopoverTrigger>
                <PopoverContent align="end" side="bottom" className="w-52 p-1.5">
                  <MenuItem icon={Plus} label="New chat" disabled />
                  <MenuItem
                    icon={expanded ? Minimize2 : Maximize2}
                    label={expanded ? "Reduce chat" : "Expand chat"}
                    onClick={() => {
                      setExpanded(!expanded);
                      setMenuOpen(false);
                    }}
                  />
                  {/* Leaves the expanded state too: expanded ignores the
                      stored size, so putting the size back while expanded
                      would look like nothing happened. */}
                  <MenuItem
                    icon={RotateCcw}
                    label="Reset size"
                    onClick={() => {
                      setExpanded(false);
                      setPanelSize(ASK_TOME_DEFAULT_SIZE);
                      setMenuOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              {/* Shut, not merely unwired. The design has this opening the
                  same question in the chat space; there is no conversation
                  here to carry over, and a button that looks live and does
                  nothing is worse than one that says it is shut. */}
              <HeaderButton label="Open Ask Tome in the chat space" disabled>
                <ExternalLink className="h-4 w-4" />
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
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`ask-tome-tab-${id}`}
                aria-controls={`ask-tome-panel-${id}`}
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "-mb-px border-b-2 border-transparent py-2.5 text-sm transition-colors",
                  tab === id
                    ? "border-cyan-500 font-semibold text-foreground dark:border-cyan-300"
                    : "font-medium text-muted-foreground hover:text-foreground",
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

      {/* Outside the panel, not in it: the panel clips what it holds, and this
          note is meant to be dragged somewhere the Webex window is not in the
          way. It stays until it is closed on its own cross, because a reader
          following three steps will be clicking around while they read. */}
      {open && webexHelpOpen && webexHelpAt && (
        <section
          aria-label="Configure Webex"
          style={{ left: webexHelpAt.x, top: webexHelpAt.y, width: WEBEX_HELP_WIDTH }}
          className="pointer-events-auto fixed z-50 rounded-xl border border-border bg-popover shadow-xl ring-1 ring-cyan-500/20 dark:border-cyan-200/40 dark:ring-cyan-200/30"
        >
          <div
            onPointerDown={startWebexHelpDrag}
            className="flex cursor-move touch-none items-center gap-1.5 border-b border-border px-3 py-2"
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
              Configure Webex
            </h3>
            <button
              type="button"
              aria-label="Close the Webex steps"
              onClick={closeWebexHelp}
              className="rounded-full p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <ol className="list-decimal space-y-2 py-3 pl-8 pr-3 text-xs text-foreground/85">
            <li>Go to Webex.</li>
            <li>Type &ldquo;tome&rdquo; in the search bar.</li>
            <li>Start a conversation with the Tome agent.</li>
          </ol>
        </section>
      )}

      <button
        type="button"
        aria-label="Open Ask Tome"
        aria-expanded={open}
        className="pointer-events-auto inline-flex shrink-0 items-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200"
        onClick={() => setOpen(!open)}
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
  // Forwarded so PopoverTrigger can anchor its menu to the button it opened
  // from; without it the menu has nothing to measure itself against.
  ref,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  ref?: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={ref}
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

/** A row of the header's overflow menu: icon, then label, nothing else. */
function MenuItem({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded px-2 py-2 text-left text-sm text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60 disabled:hover:bg-transparent"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {label}
    </button>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
