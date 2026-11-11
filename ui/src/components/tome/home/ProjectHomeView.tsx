"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { AtSign, CircleAlert, Newspaper, WifiOff } from "lucide-react";
import * as React from "react";

import { HomeAbout } from "@/components/tome/home/HomeAbout";
import { HomeAskAgent } from "@/components/tome/home/HomeAskAgent";
import { HomeChanges } from "@/components/tome/home/HomeChanges";
import {
  HomeChildren,
  type ChildrenResponse,
} from "@/components/tome/home/HomeChildren";
import { HomeCustomizeBar } from "@/components/tome/home/HomeCustomizeBar";
import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
} from "@/components/tome/home/HomeCard";
import { HomeDecisions } from "@/components/tome/home/HomeDecisions";
import { HomeGlance } from "@/components/tome/home/HomeGlance";
import { HomeKpis } from "@/components/tome/home/HomeKpis";
import { HomeMilestones } from "@/components/tome/home/HomeMilestones";
import { HomeNotificationList } from "@/components/tome/home/HomeNotificationRow";
import {
  HomePartOf,
  type AncestorRow,
} from "@/components/tome/home/HomePartOf";
import { HomeRelatedContent } from "@/components/tome/home/HomeRelatedContent";
import {
  HomeSources,
  type SourceReading,
} from "@/components/tome/home/HomeSources";
import { HomeTeam } from "@/components/tome/home/HomeTeam";
import { HomeWidgetFrame } from "@/components/tome/home/HomeWidgetFrame";
import { splitHomeFeeds } from "@/components/tome/home/home-feeds";
import { PanelHeader } from "@/components/tome/PanelHeader";
import type { RelatedContentRow } from "@/hooks/use-related-content";
import { computeReorder } from "@/lib/reorder";
import {
  cronToSchedule,
  describeSchedule,
} from "@/lib/tome/auto-ingest/schedule-presets";
import {
  TOME_HOME_WIDGETS,
  isCustomized,
  visibleWidgets,
  widgetAppliesTo,
  type TomeHomeWidgetId,
} from "@/lib/tome/home-widgets";
import { wikiPageHref } from "@/lib/tome/wiki-page-href";
import { useTomeHomeWidgetsStore } from "@/store/tome-home-widgets-store";
import type { ProjectType } from "@/types/projects";
import type { TomeSummary, TomeSummaryItem } from "@/types/tome-summary";

/**
 * A project's home page.
 *
 * The landing view used to be a digest of recent notifications, which told a
 * reader what had happened but not what the project was. This answers the
 * questions someone actually arrives with — what is this, who is on it, how
 * is it going, what wants me, where does it get its knowledge — and keeps the
 * recent activity as one card among those rather than as the whole page.
 *
 * The cards run in three bands, in the order a reader needs them. What has
 * just happened comes first, because that is what changes between two visits
 * and the only part that can be waiting on them. How the work is going comes
 * second. The roster, the sources and the KPIs come last: all three are worth
 * one read and then rarely another, so they sit where a reader can find them
 * on purpose without passing them every time.
 *
 * That is the order it ships in; a reader can arrange it otherwise, and what
 * they choose follows them into every space.
 *
 * Much of it costs nothing to show: the curated pages are already loaded for
 * the wiki beside it, and the notification cards all come out of the one
 * summary read the old digest made. The roster, the week's changes, the open
 * decisions and the last ingest are each a request of their own, because each
 * is a different record and none of them is in the digest.
 */

/** Rows per notification card. Enough to be useful, short enough to scan. */
const FEED_LIMIT = 5;

/**
 * Rows the digest is asked for, as opposed to the rows a card shows.
 *
 * A card shows five and then says how many there are, and that second number
 * has to be the entity's rather than the page size's. At BHAG level, where
 * the rows arrive from a dozen places at once, the difference between "5" and
 * "5 of 23 across 7 spaces" is the difference between a card that understates
 * the portfolio and one that describes it.
 */
const FEED_FETCH = 50;

const STANDUP_PAGE = "standup.md";
const ROADMAP_PAGE = "roadmap.md";
const CHARTER_PAGE = "charter.md";

export function ProjectHomeView({
  slug,
  title,
  description,
  kind,
  pages,
  sources,
  autoIngest,
  ancestors,
  related,
  onAsk,
  onOpenPage,
  onOpenStandup,
  onOpenSettings,
  onOpenIngest,
  onOpenFeed,
  onOpenRelated,
  onNavigate,
}: {
  slug: string;
  /** The space's own name, used where the page addresses the reader. */
  title: string;
  /**
   * The space's own description, in full.
   *
   * It used to sit clipped under the title on every view with the rest of it
   * behind a hover. `undefined` while the record is still on its way, which
   * is not the same as a space that has never been described.
   */
  description?: string | null;
  /**
   * What kind of space this is.
   *
   * It decides which cards exist — only a BHAG or an Area has anything below
   * it to list — and the wording wherever a card would otherwise tell the
   * reader of a container to go and do a project's job.
   *
   * Undefined while the entity's own record is still loading, which is not
   * the same as a project: the cards that would word themselves differently
   * wait for it rather than guess.
   */
  kind?: ProjectType;
  /** Every page's markdown, as the wiki beside this already holds it. */
  pages?: Record<string, string>;
  sources: Record<string, unknown> | null;
  /** The ingest schedule, as the space's record stores it. */
  autoIngest?: { enabled?: boolean; cron?: string } | null;
  /**
   * The spaces above this one, furthest first, as the breadcrumb reads them.
   *
   * Passed down rather than fetched: the shell around this has already
   * resolved the trail for its own crumb, and two readings of one hierarchy
   * are two chances to disagree about it.
   */
  ancestors?: readonly AncestorRow[];
  /**
   * The pages elsewhere that tag this space, `undefined` until they are in.
   *
   * Passed down for the same reason the trail is: the shell around this
   * already reads them to count its rail entry, and a card fetching them
   * again would ask the index twice for one answer.
   */
  related?: readonly RelatedContentRow[];
  onAsk: (question: string) => void;
  onOpenPage?: (path: string) => void;
  onOpenStandup?: () => void;
  onOpenSettings?: () => void;
  onOpenIngest?: () => void;
  onOpenFeed?: () => void;
  onOpenRelated?: () => void;
  onNavigate?: (href: string) => void;
}) {
  const [summary, setSummary] = React.useState<TomeSummary | null>(null);
  const [failed, setFailed] = React.useState(false);
  /** Bumped by Try again, which is the whole of the retry. */
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setFailed(false);
    // The whole space, as the digest read it: the cards below divide it up
    // themselves, and narrowing it here would only cost another request when
    // a reader wanted the rest.
    fetch(
      `/api/projects/${encodeURIComponent(slug)}/summary?scope=all&rows=${FEED_FETCH}`,
      { cache: "no-store" },
    )
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => {
        if (!cancelled) setSummary((body?.data ?? body) as TomeSummary);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  const feeds = React.useMemo(() => splitHomeFeeds(summary), [summary]);

  /** Following a row is what "I have read it" means, as it does in the bell. */
  const markRead = React.useCallback((item: TomeSummaryItem) => {
    setSummary((current) =>
      current
        ? {
            ...current,
            counts: {
              ...current.counts,
              unread: Math.max(0, current.counts.unread - 1),
            },
            sections: current.sections.map((section) => ({
              ...section,
              items: section.items.map((row) =>
                row.id === item.id ? { ...row, read: true } : row,
              ),
            })),
          }
        : current,
    );
    void fetch(`/api/notifications/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  const page = (path: string) => pages?.[path] ?? null;
  const openPage = (path: string) =>
    onOpenPage ? () => onOpenPage(path) : undefined;

  const ingestHref = `/projects/${encodeURIComponent(slug)}/tome/ingest`;
  const settingsHref = `/projects/${encodeURIComponent(slug)}/tome/settings`;
  const feedHref = `/projects/${encodeURIComponent(slug)}/tome/feed`;
  const relatedHref = `/projects/${encodeURIComponent(slug)}/tome/related`;

  /**
   * What the three notification cards show before their own answer is in.
   *
   * Waiting and empty are different states and must not look alike: telling
   * a reader nothing needs their attention, a moment before finding out that
   * something does, is worse than telling them nothing at all yet.
   */
  const layout = useTomeHomeWidgetsStore((state) => state.layout);
  const initialize = useTomeHomeWidgetsStore((state) => state.initialize);
  const hideWidget = useTomeHomeWidgetsStore((state) => state.hideWidget);
  const showWidget = useTomeHomeWidgetsStore((state) => state.showWidget);
  const reorderWidgets = useTomeHomeWidgetsStore((state) => state.reorderWidgets);
  const resetLayout = useTomeHomeWidgetsStore((state) => state.resetLayout);
  /** Arranging is a mood, not a setting: it is never saved or restored. */
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => initialize(), [initialize]);

  const container = kind === "bhag" || kind === "area";
  /** The entity's own record, which decides which cards exist and how they read. */
  const metaLoading = kind === undefined;

  /**
   * The spaces below this one, read once for the three cards that are about
   * them: what is below, where the knowledge comes from, and who answers for
   * it. A container connects almost nothing itself, so Sources and People
   * have to be roll-ups or they describe an empty goal over a full portfolio.
   */
  const [children, setChildren] = React.useState<ChildrenResponse | null>(null);
  const [childrenFailed, setChildrenFailed] = React.useState(false);

  React.useEffect(() => {
    if (!container) return;
    let cancelled = false;
    setChildren(null);
    setChildrenFailed(false);
    fetch(`/api/tome/projects/${encodeURIComponent(slug)}/children`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => {
        if (!cancelled) setChildren((body?.data ?? body) as ChildrenResponse);
      })
      .catch(() => {
        if (!cancelled) setChildrenFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, container]);

  /**
   * The newest ingest run, which is what turns the list of sources into an
   * answer about whether the wiki beside it is current.
   *
   * `undefined` while the request is out, `null` once it is in and there has
   * never been a run — a card that cannot tell those apart tells a reader
   * their space has never been read while it is still finding out.
   */
  const [lastRun, setLastRun] = React.useState<
    { at: string; status: string } | null | undefined
  >(undefined);

  React.useEffect(() => {
    let cancelled = false;
    setLastRun(undefined);
    fetch(`/api/tome/projects/${encodeURIComponent(slug)}/ingests`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => {
        const runs = ((body?.data ?? body)?.runs ?? []) as {
          started_at: string;
          status: string;
        }[];
        // The route sorts newest first, so the run to report is the first.
        const newest = runs[0];
        if (!cancelled) {
          setLastRun(newest ? { at: newest.started_at, status: newest.status } : null);
        }
      })
      .catch(() => {
        // A run list that did not come back is one line of a card, not a
        // page: Sources keeps waiting rather than claiming nothing has run.
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  /**
   * When this space reads its sources next, in plain words.
   *
   * Built from the same cron the settings panel edits, through the same
   * reader, so the two can never describe one schedule differently.
   */
  const schedule = React.useMemo(() => {
    const cron = autoIngest?.cron?.trim();
    if (!autoIngest?.enabled || !cron) return null;
    return describeSchedule(cronToSchedule(cron));
  }, [autoIngest?.enabled, autoIngest?.cron]);

  const reading: SourceReading = { lastRun, schedule };

  /** `undefined` where there is nothing below to roll up, `null` until it is in. */
  const rollup = container ? (children?.children ?? null) : undefined;
  /** The wiki's pages, which three of the cards are entirely made of. */
  const pagesLoading = pages === undefined;
  const shown = React.useMemo(
    () => visibleWidgets(layout, kind ?? "project"),
    [layout, kind],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      if (!event.over) return;
      const next = computeReorder(
        [...shown],
        String(event.active.id),
        String(event.over.id),
      );
      if (next) reorderWidgets(next as TomeHomeWidgetId[]);
    },
    [reorderWidgets, shown],
  );

  const pending = !summary && !failed ? <HomeSkeleton /> : null;
  const unreachable = failed ? (
    <HomeEmpty
      icon={<WifiOff />}
      headline="Could not load activity"
      hint="The notification request did not come back. The rest of this page is unaffected."
      action={{ label: "Try again", onClick: () => setAttempt((n) => n + 1) }}
    />
  ) : null;
  const before = pending ?? unreachable;

  /**
   * Every card, built whether or not it is on show.
   *
   * Building a hidden card costs a little render and buys a lot: nothing here
   * fetches on its own except the roster, and keeping one record of the lot
   * means the arrangement decides the order in one place rather than the JSX
   * deciding it once per card.
   */
  const cards: Record<TomeHomeWidgetId, React.ReactNode> = {
    about: (
      <HomeAbout
        description={description ?? null}
        // The description arrives with the kind, from the same record.
        loading={metaLoading || description === undefined}
        settingsHref={settingsHref}
        onOpenSettings={onOpenSettings}
      />
    ),

    ask: <HomeAskAgent title={title} onAsk={onAsk} />,

    attention: (
      <HomeCard
        title="Needs attention"
        icon={<CircleAlert className="h-4 w-4" />}
        count={feeds.attention.length}
      >
        <HomeNotificationList
          items={feeds.attention}
          viewing={slug}
          limit={FEED_LIMIT}
          onOpen={markRead}
          empty={
            before ?? (
              <HomeEmpty
                icon={<CircleAlert />}
                headline="Nothing needs attention"
                hint="Unresolved problems and decisions still to be made collect here."
              />
            )
          }
        />
        <FeedScale items={feeds.attention} container={container} />
      </HomeCard>
    ),

    tagged: (
      <HomeCard
        title="Tagged for you"
        icon={<AtSign className="h-4 w-4" />}
        count={feeds.tagged.length}
      >
        <HomeNotificationList
          items={feeds.tagged}
          viewing={slug}
          limit={FEED_LIMIT}
          onOpen={markRead}
          empty={
            before ?? (
              <HomeEmpty
                icon={<AtSign />}
                headline="Nothing tagged you"
                hint="A page or a decision that names you with an @ mention lands here."
              />
            )
          }
        />
        <FeedScale items={feeds.tagged} container={container} />
      </HomeCard>
    ),

    changes: (
      <HomeChanges
        slug={slug}
        feedHref={feedHref}
        onOpenFeed={onOpenFeed}
        ingestHref={ingestHref}
        onOpenIngest={onOpenIngest}
        container={container}
      />
    ),

    decisions: (
      <HomeDecisions
        slug={slug}
        ingestHref={ingestHref}
        onOpenIngest={onOpenIngest}
        onOpenPage={onOpenPage}
        container={container}
      />
    ),

    updates: (
      <HomeCard
        title="Latest updates"
        icon={<Newspaper className="h-4 w-4" />}
        count={feeds.updates.length}
      >
        <HomeNotificationList
          items={feeds.updates}
          viewing={slug}
          limit={FEED_LIMIT}
          onOpen={markRead}
          empty={
            before ?? (
              <HomeEmpty
                icon={<Newspaper />}
                headline="Nothing has happened yet"
                hint={
                  container
                    ? "Page edits, decisions and status updates from everything below appear here as they land."
                    : "Page edits, decisions and status updates appear here as they land."
                }
                action={{
                  label: container ? "Ingest & synthesize" : "Connect a source",
                  href: ingestHref,
                }}
              />
            )
          }
        />
        <FeedScale items={feeds.updates} container={container} />
      </HomeCard>
    ),

    children: container ? (
      <HomeChildren
        kind={kind === "bhag" ? "bhag" : "area"}
        entities={summary?.scope_entities}
        settingsHref={settingsHref}
        // Handed the rows this page already read. The slug goes instead only
        // when that read failed, which is this card fetching once for itself
        // so that it owns the error and the retry it offers for it.
        {...(children
          ? { rows: children }
          : childrenFailed
            ? { slug }
            : {})}
      />
    ) : null,

    partof: (
      <HomePartOf
        ancestors={ancestors ?? []}
        // The trail arrives with the kind, from the same record.
        loading={metaLoading || ancestors === undefined}
        settingsHref={settingsHref}
        onOpenSettings={onOpenSettings}
      />
    ),

    related: (
      <HomeRelatedContent
        related={related}
        relatedHref={relatedHref}
        onOpenRelated={onOpenRelated}
      />
    ),

    glance: (
      <HomeGlance
        markdown={page(STANDUP_PAGE)}
        standupHref={wikiPageHref(slug, STANDUP_PAGE)}
        loading={pagesLoading || metaLoading}
        container={container}
        ingestHref={ingestHref}
        onOpenStandup={onOpenStandup}
        onOpenIngest={onOpenIngest}
        onNavigate={onNavigate}
      />
    ),

    milestones: (
      <HomeMilestones
        markdown={page(ROADMAP_PAGE)}
        loading={pagesLoading || metaLoading}
        roadmapHref={wikiPageHref(slug, ROADMAP_PAGE)}
        onOpenRoadmap={openPage(ROADMAP_PAGE)}
        container={container}
        ingestHref={ingestHref}
        onOpenIngest={onOpenIngest}
      />
    ),

    team: (
      <HomeTeam
        slug={slug}
        rollup={rollup}
        settingsHref={settingsHref}
        onOpenSettings={onOpenSettings}
      />
    ),

    sources: (
      <HomeSources
        sources={sources}
        rollup={rollup}
        // Only where there is one space to ask: a roll-up answers the same
        // question from the rows below it.
        reading={container ? undefined : reading}
        loading={metaLoading}
        container={container}
        ingestHref={ingestHref}
        onOpenIngest={onOpenIngest}
      />
    ),

    kpis: (
      <HomeKpis
        markdown={page(CHARTER_PAGE)}
        loading={pagesLoading || metaLoading}
        charterHref={wikiPageHref(slug, CHARTER_PAGE)}
        onOpenCharter={openPage(CHARTER_PAGE)}
        container={container}
        ingestHref={ingestHref}
        onOpenIngest={onOpenIngest}
      />
    ),
  };

  const customizeBar = (
    <HomeCustomizeBar
      editing={editing}
      hidden={layout.hidden.filter((id) =>
        widgetAppliesTo(id as TomeHomeWidgetId, kind ?? "project"),
      )}
      customized={isCustomized(layout)}
      onEdit={() => setEditing(true)}
      onDone={() => setEditing(false)}
      onShow={showWidget}
      onReset={resetLayout}
    />
  );

  return (
    <div className="flex flex-col gap-6 p-6" data-tour="project-home">
      {/* Headed like every other place the rail leads to. Closed, the
          customize control is one quiet button and belongs on the heading's
          own row, where a panel's actions go; open, it becomes a band of
          instructions too wide for that row, so it drops below. */}
      <PanelHeader
        title="Overview"
        description="Who works on this space, what needs attention, and where its knowledge comes from."
        action={editing ? undefined : customizeBar}
      />
      {editing && customizeBar}

      {/* Three columns on a wide window, one on a narrow one, where the same
          order becomes a single column. The cards carry their own widths, so
          a card keeps its share of the page wherever it is moved to. */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={shown} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {shown.map((id) => {
              const widget = TOME_HOME_WIDGETS.find((entry) => entry.id === id);
              if (!widget) return null;
              return (
                <HomeWidgetFrame
                  key={id}
                  widget={widget}
                  editing={editing}
                  onHide={hideWidget}
                >
                  {cards[id]}
                </HomeWidgetFrame>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/**
 * How much of a feed is on screen, and how far it reaches.
 *
 * Only shown once there is more than fits, and the reach only at container
 * level: on a project every row comes from the project, so saying so would be
 * noise. The count of places is taken from the rows that were loaded, which
 * is what the sentence is about — it describes this card's contents, not a
 * census of the portfolio.
 */
function FeedScale({
  items,
  container,
}: {
  items: readonly TomeSummaryItem[];
  container: boolean;
}) {
  if (items.length <= FEED_LIMIT) return null;
  const places = new Set(items.map((item) => item.entity_slug)).size;
  return (
    <p className="mt-2 shrink-0 text-[11px] text-muted-foreground">
      Showing {FEED_LIMIT} of {items.length}
      {container && places > 1 ? ` across ${places} spaces` : ""}.
    </p>
  );
}
