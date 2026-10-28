"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { EmptyAction, EmptyArt } from "@/components/tome/TomeEmpty";
import { cn } from "@/lib/utils";

/** Somewhere to go: a route, or a view the surrounding page can open itself. */
export type HomeAction =
  | { label: string; href: string }
  | { label: string; onClick: () => void };

/**
 * The route, unless the page can show the same thing without leaving.
 *
 * Every card has both: a link that works on its own, and a handler that keeps
 * the reader inside the wiki shell when one was passed down.
 */
export function homeAction(
  label: string,
  href: string,
  onClick?: () => void,
): HomeAction {
  return onClick ? { label, onClick } : { label, href };
}

/**
 * One panel of a project's home page.
 *
 * Every card reads the same way: what it is, how many, and the way through to
 * the full thing — so a reader scanning the page learns the shape once and
 * then only reads the parts. The count is set in a low-contrast pill rather
 * than coloured like a badge, because on a page of eight cards a row of
 * badges becomes its own thing to read.
 */
export function HomeCard({
  title,
  icon,
  count,
  action,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  /** Shown beside the title when there is more than the card can hold. */
  count?: number;
  /** The way through to everything this card is a window onto. */
  action?: HomeAction;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-card shadow-sm",
        className,
      )}
    >
      <header className="flex items-center gap-2.5 border-b px-3.5 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">
          {icon}
        </span>
        <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight">
          {title}
        </h3>
        {count !== undefined && count > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
        {action && <HeaderAction action={action} />}
      </header>
      {/* A column, so a card left standing taller than its contents by the
          card beside it can centre a placeholder in the space. */}
      <div className="flex min-w-0 flex-1 flex-col px-3.5 py-3">{children}</div>
    </section>
  );
}

function HeaderAction({ action }: { action: HomeAction }) {
  const style =
    "-mr-1 ml-auto flex shrink-0 items-center gap-0.5 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  const inner = (
    <>
      {action.label}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
    </>
  );
  // Marked so the frame can take the corner back while the page is being
  // arranged, where this link and the controls that move the card would
  // otherwise be drawn on top of each other.
  return "href" in action ? (
    <Link href={action.href} className={style} data-card-action="">
      {inner}
    </Link>
  ) : (
    <button
      type="button"
      onClick={action.onClick}
      className={style}
      data-card-action=""
    >
      {inner}
    </button>
  );
}

/**
 * What a card says when it has nothing to show.
 *
 * Shaped so it cannot be mistaken for the content it stands in for: a card
 * with something in it is a left-aligned list, and this is a centred column
 * under a drawn placeholder, so an empty card is recognised before a word of
 * it is read. Every one says the same three things in the same order — what
 * is missing, what would put it there, and the one way to go and do that —
 * which is why the two lines are plain strings rather than nodes, and why
 * the way out is required rather than optional. A card with nothing in it
 * and nowhere to go is a dead end, and there is always something a reader
 * could do about an empty project.
 */
export function HomeEmpty({
  icon,
  headline,
  hint,
  action,
}: {
  /** The card's own subject, drawn inside the placeholder. */
  icon: React.ReactNode;
  /** What is missing, in a few words: "No standup yet". */
  headline: string;
  /** One sentence on what appears here, and what writes it. */
  hint: string;
  action: HomeAction;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 py-6 text-center">
      <EmptyArt>{icon}</EmptyArt>
      <p className="text-xs font-medium text-foreground/80">{headline}</p>
      <p className="max-w-[38ch] text-[11px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
      <EmptyAction action={action} />
    </div>
  );
}

/** Widths that stop the waiting rows looking like a bar chart. */
const SKELETON_WIDTHS = ["w-4/5", "w-3/5", "w-11/12", "w-2/3"];

/**
 * Rows that are still on their way.
 *
 * Shaped like the list it stands in for, so the card does not jump when the
 * answer lands, and plainly unreadable so nobody waits for it to resolve into
 * words. It matters that this is distinct from the empty state: a card that
 * has not loaded has not yet earned the right to tell a reader their project
 * is empty.
 */
export function HomeSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 py-1">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="flex items-center gap-2" aria-hidden="true">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted" />
          <span
            className={cn(
              "h-2.5 animate-pulse rounded-full bg-muted",
              SKELETON_WIDTHS[index % SKELETON_WIDTHS.length],
            )}
          />
        </span>
      ))}
    </div>
  );
}
