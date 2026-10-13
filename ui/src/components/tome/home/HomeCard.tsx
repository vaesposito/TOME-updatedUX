"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * One panel of a project's home page.
 *
 * Every card reads the same way: what it is, how many, and the way through to
 * the full thing — so a reader scanning the page learns the shape once. The
 * count sits in the heading rather than on a badge beside it, because on a
 * page this dense a row of badges becomes its own thing to read.
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
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("flex min-w-0 flex-col rounded-lg border bg-card", className)}
    >
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <h3 className="min-w-0 truncate text-sm font-semibold">{title}</h3>
        {count !== undefined && count > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
        {action && (
          <span className="ml-auto shrink-0">
            {"href" in action ? (
              <Link
                href={action.href}
                className="flex items-center gap-0.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {action.label}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={action.onClick}
                className="flex items-center gap-0.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {action.label}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </span>
        )}
      </header>
      <div className="min-w-0 flex-1 px-4 py-3">{children}</div>
    </section>
  );
}

/**
 * What a card says when it has nothing to show.
 *
 * Phrased as the state of the project rather than as a fault of the page:
 * most of these cards are empty because nobody has written the thing yet, and
 * saying which thing is the only way a reader could go and fix it.
 */
export function HomeEmpty({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: { label: string; href: string };
}) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {children}
      {action && (
        <>
          {" "}
          <Link
            href={action.href}
            className="font-medium text-foreground/80 underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
          >
            {action.label}
          </Link>
        </>
      )}
    </p>
  );
}
