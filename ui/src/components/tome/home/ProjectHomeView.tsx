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

import { HomeAskAgent } from "@/components/tome/home/HomeAskAgent";
import { HomeCustomizeBar } from "@/components/tome/home/HomeCustomizeBar";
import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
} from "@/components/tome/home/HomeCard";
import { HomeGlance } from "@/components/tome/home/HomeGlance";
import { HomeKpis } from "@/components/tome/home/HomeKpis";
import { HomeMilestones } from "@/components/tome/home/HomeMilestones";
import { HomeNotificationList } from "@/components/tome/home/HomeNotificationRow";
import { HomeSources } from "@/components/tome/home/HomeSources";
import { HomeTeam } from "@/components/tome/home/HomeTeam";
import { HomeWidgetFrame } from "@/components/tome/home/HomeWidgetFrame";
import { splitHomeFeeds } from "@/components/tome/home/home-feeds";
import { computeReorder } from "@/lib/reorder";
import {
  TOME_HOME_WIDGETS,
  isCustomized,
  visibleWidgets,
  type TomeHomeWidgetId,
} from "@/lib/tome/home-widgets";
import { wikiPageHref } from "@/lib/tome/wiki-page-href";
import { useTomeHomeWidgetsStore } from "@/store/tome-home-widgets-store";
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
 * Most of it costs nothing to show: the curated pages are already loaded for
 * the wiki beside it, and the notification cards all come out of the one
 * summary read the old digest made. Only the roster is a request of its own.
 */

/** Rows per notification card. Enough to be useful, short enough to scan. */
const FEED_LIMIT = 5;

const STANDUP_PAGE = "standup.md";
const ROADMAP_PAGE = "roadmap.md";
const CHARTER_PAGE = "charter.md";

export function ProjectHomeView({
  slug,
  title,
  pages,
  sources,
  onAsk,
  onOpenPage,
  onOpenStandup,
  onOpenSettings,
  onOpenIngest,
  onNavigate,
}: {
  slug: string;
  /** The space's own name, used where the page addresses the reader. */
  title: string;
  /** Every page's markdown, as the wiki beside this already holds it. */
  pages?: Record<string, string>;
  sources: Record<string, unknown> | null;
  onAsk: (question: string) => void;
  onOpenPage?: (path: string) => void;
  onOpenStandup?: () => void;
  onOpenSettings?: () => void;
  onOpenIngest?: () => void;
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
    fetch(`/api/projects/${encodeURIComponent(slug)}/summary?scope=all`, {
      cache: "no-store",
    })
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

  /** Following a row is what "I have read it" means, as in the inbox. */
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

  /**
   * Everything this space has sent, where it can be worked through.
   *
   * On the All tab, not the inbox's usual Unread: these cards show what is
   * there rather than what is new, so a reader following one of them to "see
   * the rest" has often read the rest already.
   */
  const inboxHref = `/notifications?entity=${encodeURIComponent(slug)}&tab=all`;
  const ingestHref = `/projects/${encodeURIComponent(slug)}/tome/ingest`;
  const settingsHref = `/projects/${encodeURIComponent(slug)}/tome/settings`;

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

  const shown = React.useMemo(() => visibleWidgets(layout), [layout]);

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
   * deciding it in nine.
   */
  const cards: Record<TomeHomeWidgetId, React.ReactNode> = {
    ask: <HomeAskAgent title={title} onAsk={onAsk} />,

    attention: (
      <HomeCard
        title="Needs attention"
        icon={<CircleAlert className="h-4 w-4" />}
        count={feeds.attention.length}
        action={{ label: "All", href: inboxHref }}
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
                action={{ label: "Open the inbox", href: inboxHref }}
              />
            )
          }
        />
      </HomeCard>
    ),

    tagged: (
      <HomeCard
        title="Tagged for you"
        icon={<AtSign className="h-4 w-4" />}
        count={feeds.tagged.length}
        action={{ label: "All", href: inboxHref }}
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
                action={{ label: "Open the inbox", href: inboxHref }}
              />
            )
          }
        />
      </HomeCard>
    ),

    updates: (
      <HomeCard
        title="Latest updates"
        icon={<Newspaper className="h-4 w-4" />}
        count={feeds.updates.length}
        action={{ label: "All", href: inboxHref }}
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
                hint="Page edits, decisions and status updates appear here as they land."
                action={{ label: "Connect a source", href: ingestHref }}
              />
            )
          }
        />
      </HomeCard>
    ),

    glance: (
      <HomeGlance
        markdown={page(STANDUP_PAGE)}
        standupHref={wikiPageHref(slug, STANDUP_PAGE)}
        ingestHref={ingestHref}
        onOpenStandup={onOpenStandup}
        onOpenIngest={onOpenIngest}
        onNavigate={onNavigate}
      />
    ),

    milestones: (
      <HomeMilestones
        markdown={page(ROADMAP_PAGE)}
        roadmapHref={wikiPageHref(slug, ROADMAP_PAGE)}
        onOpenRoadmap={openPage(ROADMAP_PAGE)}
      />
    ),

    team: (
      <HomeTeam
        slug={slug}
        settingsHref={settingsHref}
        onOpenSettings={onOpenSettings}
      />
    ),

    sources: (
      <HomeSources
        sources={sources}
        ingestHref={ingestHref}
        onOpenIngest={onOpenIngest}
      />
    ),

    kpis: (
      <HomeKpis
        markdown={page(CHARTER_PAGE)}
        charterHref={wikiPageHref(slug, CHARTER_PAGE)}
        onOpenCharter={openPage(CHARTER_PAGE)}
      />
    ),
  };

  return (
    <div className="flex flex-col gap-3 p-5" data-tour="project-home">
      <HomeCustomizeBar
        editing={editing}
        hidden={layout.hidden}
        customized={isCustomized(layout)}
        onEdit={() => setEditing(true)}
        onDone={() => setEditing(false)}
        onShow={showWidget}
        onReset={resetLayout}
      />

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
