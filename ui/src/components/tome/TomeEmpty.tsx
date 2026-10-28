"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Somewhere to go from a place with nothing in it.
 *
 * `newTab` is for destinations outside the thing being looked at — a
 * credentials screen, a repository — where coming back matters and the work
 * on this page would not survive the trip.
 */
export type TomeEmptyAction =
  | { label: string; href: string; newTab?: boolean }
  | { label: string; onClick: () => void };

/**
 * The illustration every empty state is drawn under.
 *
 * A dashed ring around a soft disc, holding the subject's own icon: the ring
 * means "not filled in yet" the way a dashed outline does everywhere else,
 * and the icon says which thing is not filled in. Hidden from assistive
 * technology, where the headline underneath already carries the whole
 * message and a second rendering of the icon would only repeat it.
 */
export function EmptyArt({
  children,
  size = "sm",
}: {
  children: React.ReactNode;
  /** `sm` inside a card, `lg` where an empty state has a whole view to itself. */
  size?: "sm" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative mb-0.5 flex items-center justify-center",
        size === "sm" ? "h-11 w-11" : "h-16 w-16",
      )}
    >
      <span className="absolute inset-0 rounded-full border border-dashed border-border" />
      <span
        className={cn(
          "absolute rounded-full bg-gradient-to-b from-muted to-muted/30",
          size === "sm" ? "inset-[5px]" : "inset-[7px]",
        )}
      />
      <span
        className={cn(
          "relative text-muted-foreground/70",
          size === "sm"
            ? "[&>svg]:h-[1.125rem] [&>svg]:w-[1.125rem]"
            : "[&>svg]:h-6 [&>svg]:w-6",
        )}
      >
        {children}
      </span>
    </span>
  );
}

export function EmptyAction({
  action,
  size = "sm",
}: {
  action: TomeEmptyAction;
  size?: "sm" | "lg";
}) {
  const style = size === "sm" ? "mt-1 h-7 px-2.5 text-xs" : "mt-2";

  if (!("href" in action)) {
    return (
      <Button
        type="button"
        variant="outline"
        size={size === "sm" ? "sm" : "default"}
        onClick={action.onClick}
        className={style}
      >
        {action.label}
      </Button>
    );
  }

  return (
    <Button asChild variant="outline" size={size === "sm" ? "sm" : "default"} className={style}>
      <Link
        href={action.href}
        {...(action.newTab
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
      >
        {action.label}
        {action.newTab && <ExternalLink className="h-3.5 w-3.5" aria-hidden />}
      </Link>
    </Button>
  );
}

/**
 * What a view says when it has nothing to show.
 *
 * Shaped so it cannot be mistaken for the content it stands in for: content
 * is a left-aligned list, and this is a centred column under a drawn
 * placeholder, so an empty view is recognised before a word of it is read.
 *
 * Every one says the same three things in the same order — what is missing,
 * what would put it there, and the one way to go and do that — which is why
 * the two lines are plain strings rather than nodes. The way out is optional
 * only because a reader without permission to fill a view has nowhere to be
 * sent; wherever there is something to do, there is a button.
 */
export function TomeEmpty({
  icon,
  headline,
  hint,
  action,
  className,
}: {
  /** The view's own subject, drawn inside the placeholder. */
  icon: React.ReactNode;
  /** What is missing, in a few words: "No ingests yet". */
  headline: string;
  /** One sentence on what appears here, and what puts it there. */
  hint: string;
  action?: TomeEmptyAction;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-14 text-center",
        className,
      )}
    >
      <EmptyArt size="lg">{icon}</EmptyArt>
      <p className="text-sm font-medium text-foreground">{headline}</p>
      <p className="max-w-[46ch] text-xs leading-relaxed text-muted-foreground">
        {hint}
      </p>
      {action && <EmptyAction action={action} size="lg" />}
    </div>
  );
}
