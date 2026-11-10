"use client";

import {
  Activity,
  GitBranch,
  Flag,
  RefreshCw,
  StickyNote,
  WifiOff,
} from "lucide-react";
import * as React from "react";

import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";
import {
  collapseChanges,
  type ChangeRow,
  type FeedEvent,
} from "@/components/tome/home/home-changes";
import { formatRelativeTimeCompact } from "@/lib/utils";

/**
 * What has happened to this space in the last seven days.
 *
 * Distinct from Latest updates, which is the reader's notifications: this is
 * the space's own record, so it says what the ingests and the connected
 * repositories did whether or not anybody was told about it. A week because
 * that is the span a reader coming back after a few days is asking about;
 * longer and the card stops being news.
 *
 * A run that started, finished and was reviewed is one change, not three —
 * `collapseChanges` folds the transitions the producers already tie together.
 */

/** Rows a card shows before it says how many there are. */
const SHOWN = 6;

/** Rows asked for, as opposed to rows shown: a busy week collapses a lot. */
const FETCHED = 200;

const GLYPHS: Record<string, React.ReactNode> = {
  ingest_event: <RefreshCw className="h-3 w-3" />,
  source_event: <GitBranch className="h-3 w-3" />,
  promoted_action: <Flag className="h-3 w-3" />,
  gist_ref: <StickyNote className="h-3 w-3" />,
};

type State =
  | { status: "loading" }
  | { status: "ready"; rows: ChangeRow[] }
  /** The feed is not wired up in this deployment, which is not a failure. */
  | { status: "unconfigured" }
  | { status: "failed" };

export function HomeChanges({
  slug,
  feedHref,
  onOpenFeed,
  ingestHref,
  onOpenIngest,
  container = false,
}: {
  slug: string;
  /** The whole record, where a week of it is not enough. */
  feedHref: string;
  onOpenFeed?: () => void;
  /** Where a space with nothing to report is given something to read. */
  ingestHref: string;
  onOpenIngest?: () => void;
  /** Whether this space holds other spaces, which changes only the wording. */
  container?: boolean;
}) {
  const [state, setState] = React.useState<State>({ status: "loading" });
  /** Bumped by Try again, which is the whole of the retry. */
  const [attempt, setAttempt] = React.useState(0);
  /** One clock for the whole card, so the week does not move between rows. */
  const [now] = React.useState(() => Date.now());

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(
      `/api/tome/projects/${encodeURIComponent(slug)}/feed?limit=${FETCHED}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        if (response.status === 503) {
          if (!cancelled) setState({ status: "unconfigured" });
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json();
        const messages = ((body?.data ?? body)?.messages ?? []) as FeedEvent[];
        if (!cancelled) {
          setState({ status: "ready", rows: collapseChanges(messages, now) });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, attempt, now]);

  const rows = state.status === "ready" ? state.rows : [];

  return (
    <HomeCard
      title="Changed this week"
      icon={<Activity className="h-4 w-4" />}
      count={rows.length}
      action={homeAction("All activity", feedHref, onOpenFeed)}
    >
      {state.status === "loading" ? (
        <HomeSkeleton rows={4} />
      ) : state.status === "unconfigured" ? (
        <HomeEmpty
          icon={<Activity />}
          headline="No activity feed here"
          hint="This deployment has no feed behind it, so a space's own record of what happened is not kept."
          action={homeAction("Open the feed", feedHref, onOpenFeed)}
        />
      ) : state.status === "failed" ? (
        <HomeEmpty
          icon={<WifiOff />}
          headline="Could not load this week"
          hint="The feed request did not come back. Nothing else on this page depends on it."
          action={{ label: "Try again", onClick: () => setAttempt((n) => n + 1) }}
        />
      ) : rows.length === 0 ? (
        <HomeEmpty
          icon={<Activity />}
          headline="A quiet week"
          hint={
            container
              ? "Ingests and source activity from the last seven days appear here as they land."
              : "Ingests, source activity and promoted actions from the last seven days appear here as they land."
          }
          action={homeAction(
            container ? "Ingest & synthesize" : "Run an ingest",
            ingestHref,
            onOpenIngest,
          )}
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.slice(0, SHOWN).map((row) => (
            <li key={row.id} className="flex min-w-0 items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"
              >
                {GLYPHS[row.kind] ?? <Activity className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{row.title}</span>
                {row.detail && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {row.detail}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {formatRelativeTimeCompact(row.at)}
              </span>
            </li>
          ))}
          {rows.length > SHOWN && (
            <li className="text-[11px] text-muted-foreground">
              and {rows.length - SHOWN} more
            </li>
          )}
        </ul>
      )}
    </HomeCard>
  );
}
