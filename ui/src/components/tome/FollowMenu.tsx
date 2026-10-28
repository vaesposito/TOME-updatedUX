"use client";

import { Bell, BellOff, Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_FOLLOW_LEVEL,
  FOLLOW_LEVELS,
  followLevelSummary,
  isFollowing,
  levelFromWatching,
  type FollowLevel,
} from "@/lib/tome/follow-levels";
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
 * Follow a Tome space, and say how much of it you want to hear about.
 *
 * Following itself is real: the three loud levels subscribe and Off
 * unsubscribes, through the same endpoint the plain watch toggle used. Which
 * of the three is chosen is presentational — nothing downstream separates an
 * important update from an ordinary one yet — so the choice is kept for the
 * session and the menu does not claim it has been saved.
 *
 * The button hides itself when the watch endpoint is unreachable or the
 * caller cannot read the space, so a header on a restricted or offline page
 * does not show a control that can never succeed.
 */
export function FollowMenu({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  const [state, setState] = useState<WatchState | null>(null);
  const [level, setLevel] = useState<FollowLevel>(DEFAULT_FOLLOW_LEVEL);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  const endpoint = `/api/projects/${encodeURIComponent(slug)}/watch`;

  // Re-read on the same event a change fires. Following is also written away
  // from this button — saving a page subscribes the editor, for one — so the
  // label has to be able to learn it was wrong without a reload.
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) throw new Error(`watch state ${response.status}`);
        const next = unwrap(await response.json());
        if (cancelled) return;
        setState(next);
        // Only follow the server when it disagrees about whether the reader
        // hears anything. A reader who picked Important should keep it.
        setLevel((current) => (
          next.watching === isFollowing(current)
            ? current
            : levelFromWatching(next.watching)
        ));
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

  const choose = useCallback(async (next: FollowLevel) => {
    if (!state || pending) return;
    setOpen(false);
    const previousLevel = level;
    setLevel(next);

    const wanted = isFollowing(next);
    if (wanted === state.watching) return;

    setPending(true);
    // Optimistic: the header should respond immediately, and a failed
    // request restores the server's answer below.
    setState({
      watching: wanted,
      watcher_count: Math.max(0, state.watcher_count + (wanted ? 1 : -1)),
    });
    try {
      const response = await fetch(endpoint, { method: wanted ? "POST" : "DELETE" });
      if (!response.ok) throw new Error(`watch toggle ${response.status}`);
      setState(unwrap(await response.json()));
      window.dispatchEvent(new Event("in-app-notifications:refresh"));
    } catch {
      setState(state);
      setLevel(previousLevel);
    } finally {
      setPending(false);
    }
  }, [endpoint, level, pending, state]);

  if (!state) return null;

  const following = state.watching;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-auto gap-1.5 px-2 py-1", className)}
          data-tour="watch-toggle"
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {following ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
          {following ? "Following" : "Follow"}
          {state.watcher_count > 0 && (
            <span className="text-muted-foreground">{state.watcher_count}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          <p className="text-xs text-muted-foreground">{followLevelSummary(level)}</p>
        </div>
        <div role="menu" aria-label="How much to hear about this space" className="py-1">
          {FOLLOW_LEVELS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={level === entry.id}
              onClick={() => void choose(entry.id)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted"
            >
              <Check
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0 text-primary",
                  level !== entry.id && "invisible",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{entry.label}</span>
                <span className="block text-xs text-muted-foreground">{entry.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="border-t px-3 py-2.5">
          <Link
            href="/notifications?tab=following"
            className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-4 hover:no-underline"
          >
            Manage notifications
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
