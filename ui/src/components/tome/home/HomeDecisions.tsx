"use client";

import { Scale, WifiOff } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
  homeAction,
} from "@/components/tome/home/HomeCard";
import { wikiPageHref } from "@/lib/tome/wiki-page-href";

/**
 * The decisions this space is still carrying.
 *
 * A decision the agent has written down is a question somebody has to answer,
 * and until they do it is the one thing on this page that is nobody's by
 * default. Accepted and rejected ones are gone from here the moment they are
 * settled: the record of them is the page itself.
 *
 * Read at a container's altitude the endpoint already rolls up the spaces
 * below, so a row can belong to another space — which is why each one says
 * where it came from and links there rather than into this wiki.
 */

interface DecisionItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  owner: string | null;
  opened: string | null;
  source_project_slug: string;
  path: string;
}

/** A decision that has been settled is not open, however it was settled. */
const CLOSED = new Set(["accepted", "rejected"]);

/** Rows a card shows before it says how many there are. */
const SHOWN = 5;

export function HomeDecisions({
  slug,
  ingestHref,
  onOpenIngest,
  onOpenPage,
  container = false,
}: {
  slug: string;
  /** Where a space with no decisions on record is given something to read. */
  ingestHref: string;
  onOpenIngest?: () => void;
  /** Opens a page of this space without leaving the wiki shell. */
  onOpenPage?: (path: string) => void;
  /** Whether this space holds other spaces, which changes only the wording. */
  container?: boolean;
}) {
  const [items, setItems] = React.useState<DecisionItem[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  /** Bumped by Try again, which is the whole of the retry. */
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setItems(null);
    fetch(`/api/tome/projects/${encodeURIComponent(slug)}/critical-items`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => {
        const rows = ((body?.data ?? body)?.items ?? []) as DecisionItem[];
        if (!cancelled) setItems(rows.filter((item) => !CLOSED.has(item.status)));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  return (
    <HomeCard
      title="Open decisions"
      icon={<Scale className="h-4 w-4" />}
      count={items?.length}
    >
      {failed ? (
        <HomeEmpty
          icon={<WifiOff />}
          headline="Could not load decisions"
          hint="The request did not come back. Nothing else on this page depends on it."
          action={{ label: "Try again", onClick: () => setAttempt((n) => n + 1) }}
        />
      ) : !items ? (
        <HomeSkeleton rows={3} />
      ) : items.length === 0 ? (
        <HomeEmpty
          icon={<Scale />}
          headline="No open decisions"
          hint={
            container
              ? "A proposed decision anywhere below this stays here until it is accepted or rejected."
              : "A decision the agent proposes stays here until it is accepted or rejected."
          }
          action={homeAction(
            container ? "Ingest & synthesize" : "Run an ingest",
            ingestHref,
            onOpenIngest,
          )}
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.slice(0, SHOWN).map((item) => (
            <li key={item.id} className="min-w-0">
              <DecisionRow
                item={item}
                // A decision of this space opens in place; one rolled up from
                // a space below is a trip, and says so by being a link.
                onOpen={
                  item.source_project_slug === slug && onOpenPage
                    ? () => onOpenPage(item.path)
                    : undefined
                }
                elsewhere={item.source_project_slug !== slug}
              />
            </li>
          ))}
          {items.length > SHOWN && (
            <li className="text-[11px] text-muted-foreground">
              and {items.length - SHOWN} more
            </li>
          )}
        </ul>
      )}
    </HomeCard>
  );
}

function DecisionRow({
  item,
  onOpen,
  elsewhere,
}: {
  item: DecisionItem;
  onOpen?: () => void;
  elsewhere: boolean;
}) {
  const detail = [
    item.owner ? `Owner ${item.owner}` : null,
    item.opened ? `opened ${item.opened}` : null,
    elsewhere ? item.source_project_slug : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"
      >
        <Scale className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs">{item.title}</span>
        {detail && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
        {item.priority}
      </span>
    </>
  );

  const style =
    "flex w-full min-w-0 items-start gap-2 rounded-md text-left transition-colors hover:text-foreground";

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={style}>
        {body}
      </button>
    );
  }
  return (
    <Link
      href={wikiPageHref(item.source_project_slug, item.path)}
      className={style}
    >
      {body}
    </Link>
  );
}
