"use client";

import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface WatchState {
  watching: boolean;
  watcher_count: number;
}

function unwrap(value: unknown): WatchState {
  const body = value as { data?: WatchState } & Partial<WatchState>;
  const state = body.data ?? body;
  return {
    watching: Boolean(state.watching),
    watcher_count: Number(state.watcher_count ?? 0),
  };
}

/**
 * "Follow" / "Following" toggle, for a Tome entity or for one wiki page inside
 * it. Watching subscribes the signed-in user to in-app notifications when the
 * thing changes.
 *
 * `pagePath` narrows the subscription to that page. The two are independent:
 * watching the entity already covers every page in it, so a page subscription
 * is for someone who wants one document without the rest of the entity's
 * traffic.
 *
 * The button hides itself when the watch endpoint is unreachable or the caller
 * cannot read the entity, so a header on a restricted or offline page does not
 * show a control that can never succeed.
 */
export function WatchToggle({
  slug,
  pagePath,
  className,
}: {
  slug: string;
  pagePath?: string;
  className?: string;
}) {
  const [state, setState] = useState<WatchState | null>(null);
  const [pending, setPending] = useState(false);

  const endpoint = `/api/projects/${encodeURIComponent(slug)}/watch${
    pagePath ? `?page=${encodeURIComponent(pagePath)}` : ""
  }`;

  // Re-read on the same event a toggle fires. Watching is also written away
  // from this button — saving a page subscribes the editor, for one — so the
  // label has to be able to learn it was wrong without a reload.
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) throw new Error(`watch state ${response.status}`);
        const next = unwrap(await response.json());
        if (!cancelled) setState(next);
      } catch {
        if (!cancelled) setState(null);
      }
    };
    void read();
    const refresh = () => void read();
    window.addEventListener("in-app-notifications:refresh", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("in-app-notifications:refresh", refresh);
    };
  }, [endpoint]);

  const toggle = useCallback(async () => {
    if (!state || pending) return;
    const next = !state.watching;
    setPending(true);
    // Optimistic: the header should respond immediately, and a failed request
    // restores the server's answer below.
    setState({
      watching: next,
      watcher_count: Math.max(0, state.watcher_count + (next ? 1 : -1)),
    });
    try {
      const response = await fetch(endpoint, {
        method: next ? "POST" : "DELETE",
      });
      if (!response.ok) throw new Error(`watch toggle ${response.status}`);
      setState(unwrap(await response.json()));
      window.dispatchEvent(new Event("in-app-notifications:refresh"));
    } catch {
      setState(state);
    } finally {
      setPending(false);
    }
  }, [endpoint, pending, state]);

  if (!state) return null;

  const label = state.watching ? "Following" : "Follow";
  const noun = pagePath ? "This page." : "This space.";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-auto gap-1.5 px-2 py-1", className)}
          // The walkthrough points at watching a whole space, and a wiki page
          // carries one of these for the page as well as the space's own.
          data-tour={pagePath ? undefined : "watch-toggle"}
          onClick={() => void toggle()}
          disabled={pending}
          aria-pressed={state.watching}
        >
          {state.watching ? (
            <Bell className="h-3.5 w-3.5" />
          ) : (
            <BellOff className="h-3.5 w-3.5" />
          )}
          {label}
          {state.watcher_count > 0 && (
            <span className="text-muted-foreground">{state.watcher_count}</span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {noun} {state.watching
          ? "You get a notification when it changes. Click to stop following."
          : "Get a notification when it changes."}
      </TooltipContent>
    </Tooltip>
  );
}
