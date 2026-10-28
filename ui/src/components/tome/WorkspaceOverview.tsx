"use client";

/**
 * The hub's Overview tab: a space's home page, read across every space at once.
 *
 * Four cards, not all nine. A card that puts a question to this space's
 * agent, or reads its roadmap page, or names its stewards, has no answer when
 * "this space" is all of them; what survives the move up is everything made
 * of rows — what is waiting, what named the reader, what happened, and where.
 * Which four is not decided here but declared on the cards themselves, so
 * adding a card to a project's home is also the moment to say whether it
 * means anything from up here.
 *
 * The arrangement is the reader's own, shared with every project home: the
 * cards mean the same thing at either altitude, so hiding one in a project
 * and finding it here would make the eye a per-page setting nobody asked for.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
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

import {
  HomeCard,
  HomeEmpty,
  HomeSkeleton,
} from "@/components/tome/home/HomeCard";
import {
  HomeChildren,
  type ChildrenResponse,
} from "@/components/tome/home/HomeChildren";
import { HomeCustomizeBar } from "@/components/tome/home/HomeCustomizeBar";
import { HomeNotificationList } from "@/components/tome/home/HomeNotificationRow";
import { HomeWidgetFrame } from "@/components/tome/home/HomeWidgetFrame";
import { splitHomeFeeds } from "@/components/tome/home/home-feeds";
import { computeReorder } from "@/lib/reorder";
import {
  TOME_HOME_WIDGETS,
  isCustomized,
  visibleWidgets,
  widgetAppliesTo,
  type TomeHomeWidgetId,
} from "@/lib/tome/home-widgets";
import { useTomeHomeWidgetsStore } from "@/store/tome-home-widgets-store";
import type { TomeSummary, TomeSummaryItem } from "@/types/tome-summary";

interface OverviewResponse {
  summary: TomeSummary | null;
  spaces: ChildrenResponse["children"];
  total: number;
  withheld: number;
}

/** Rows per card, as on a space's own home. */
const ROWS = 4;

const INBOX = "/notifications";

export function WorkspaceOverview() {
  const [data, setData] = React.useState<OverviewResponse | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetch("/api/tome/overview", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => {
        if (!cancelled) setData((body?.data ?? body) as OverviewResponse);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const layout = useTomeHomeWidgetsStore((state) => state.layout);
  const initialize = useTomeHomeWidgetsStore((state) => state.initialize);
  const hideWidget = useTomeHomeWidgetsStore((state) => state.hideWidget);
  const showWidget = useTomeHomeWidgetsStore((state) => state.showWidget);
  const reorderWidgets = useTomeHomeWidgetsStore(
    (state) => state.reorderWidgets,
  );
  const resetLayout = useTomeHomeWidgetsStore((state) => state.resetLayout);
  /** Arranging is a mood, not a setting: it is never saved or restored. */
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => initialize(), [initialize]);

  const shown = React.useMemo(
    () => visibleWidgets(layout, "workspace"),
    [layout],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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

  const feeds = React.useMemo(
    () => splitHomeFeeds(data?.summary ?? null),
    [data?.summary],
  );

  /**
   * Following a row is what "I have read it" means, as in the inbox.
   *
   * Only the count and the row's own state: the row is a link and does its
   * own navigating. Sending it somewhere from here as well pointed it at
   * `item.href` while the link pointed at the artifact, so an unread row
   * raced itself to two different places.
   */
  const markRead = React.useCallback((item: TomeSummaryItem) => {
    setData((current) =>
      current
        ? {
            ...current,
            summary: current.summary
              ? {
                  ...current.summary,
                  counts: {
                    ...current.summary.counts,
                    unread: Math.max(0, current.summary.counts.unread - 1),
                  },
                  sections: current.summary.sections.map((section) => ({
                    ...section,
                    items: section.items.map((row) =>
                      row.id === item.id ? { ...row, read: true } : row,
                    ),
                  })),
                }
              : current.summary,
          }
        : current,
    );
  }, []);

  const pending = !data && !failed ? <HomeSkeleton rows={2} /> : null;
  const unreachable = failed ? (
    <HomeEmpty
      icon={<WifiOff />}
      headline="Could not load activity"
      hint="What is happening across your spaces did not come back. Nothing else on this page is affected."
      action={{ label: "Try again", onClick: () => setAttempt((n) => n + 1) }}
    />
  ) : null;
  const before = pending ?? unreachable;

  /**
   * Every card, built whether or not it is on show, so the arrangement above
   * decides the order in one place rather than the JSX deciding it here.
   */
  const cards: Partial<Record<TomeHomeWidgetId, React.ReactNode>> = {
    attention: (
      <HomeCard
        title="Needs attention"
        icon={<CircleAlert className="h-4 w-4" />}
        count={feeds.attention.length}
        action={{ label: "All", href: `${INBOX}?filter=attention` }}
      >
        {before ?? (
          <HomeNotificationList
            items={feeds.attention}
            viewing=""
            limit={ROWS}
            onOpen={markRead}
            newTab
            empty={
              <HomeEmpty
                icon={<CircleAlert />}
                headline="Nothing needs attention"
                hint="Problems still unresolved and decisions still to be made collect here, from every space you can see."
                action={{ label: "Open the inbox", href: INBOX }}
              />
            }
          />
        )}
      </HomeCard>
    ),

    tagged: (
      <HomeCard
        title="Tagged for you"
        icon={<AtSign className="h-4 w-4" />}
        count={feeds.tagged.length}
        action={{ label: "All", href: `${INBOX}?filter=tagged` }}
      >
        {before ?? (
          <HomeNotificationList
            items={feeds.tagged}
            viewing=""
            limit={ROWS}
            onOpen={markRead}
            newTab
            empty={
              <HomeEmpty
                icon={<AtSign />}
                headline="Nothing tagged you"
                hint="A page or a decision that names you lands here, wherever it was written."
                action={{ label: "Open the inbox", href: INBOX }}
              />
            }
          />
        )}
      </HomeCard>
    ),

    updates: (
      <HomeCard
        title="Latest updates"
        icon={<Newspaper className="h-4 w-4" />}
        count={feeds.updates.length}
        action={{ label: "All", href: INBOX }}
      >
        {before ?? (
          <HomeNotificationList
            items={feeds.updates}
            viewing=""
            limit={ROWS}
            onOpen={markRead}
            newTab
            empty={
              <HomeEmpty
                icon={<Newspaper />}
                headline="Nothing has happened yet"
                hint="Pages written, decisions recorded and milestones moved appear here as they happen."
                action={{ label: "Open the inbox", href: INBOX }}
              />
            }
          />
        )}
      </HomeCard>
    ),

    /*
      Given its rows rather than left to fetch them: they arrived with the
      digest above, out of the one read that produced both.
    */
    children: (
      <HomeChildren
        kind="workspace"
        newTab
        settingsHref="/projects"
        entities={data?.summary?.scope_entities}
        {...(data
          ? {
              rows: {
                children: data.spaces,
                total: data.total,
                withheld: data.withheld,
              },
            }
          : {})}
      />
    ),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
        <HomeCustomizeBar
          editing={editing}
          hidden={layout.hidden.filter((id) =>
            widgetAppliesTo(id, "workspace"),
          )}
          customized={isCustomized(layout)}
          onEdit={() => setEditing(true)}
          onDone={() => setEditing(false)}
          onShow={showWidget}
          onReset={resetLayout}
        />
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={[...shown]} strategy={rectSortingStrategy}>
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
            {shown.map((id) => {
              const widget = TOME_HOME_WIDGETS.find(
                (entry) => entry.id === id,
              );
              if (!widget || !cards[id]) return null;
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
