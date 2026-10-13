"use client";

import {
  Archive,
  ChevronRight,
  Inbox,
  MailOpen,
  Undo2,
  VolumeX,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import {
  FilterDropdown,
  FilterOption,
  NotificationFilterBar,
} from "@/components/notifications/NotificationFilterBar";
import { NotificationFollowTree } from "@/components/notifications/NotificationFollowTree";
import { NotificationRow } from "@/components/notifications/NotificationRow";
import { SelectionCheckbox } from "@/components/notifications/SelectionCheckbox";
import { TourStartButton } from "@/components/tour/TourStartButton";
import {
  groupByAction,
  groupByDay,
  groupByOrigin,
} from "@/components/notifications/notification-presentation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  EMPTY_NOTIFICATION_FILTER,
  isEmptyNotificationFilter,
  type InAppNotificationView,
  type NotificationFollowTree as FollowTreeData,
  type NotificationInboxFilter,
  type NotificationInboxResponse,
  type NotificationInboxTab,
  type NotificationPageView,
} from "@/types/in-app-notification";

const EMPTY_FOLLOW_TREE: FollowTreeData = { nodes: [], total_unread: 0 };

/** Guards the tab a link may ask for against the ones that exist. */
const INBOX_TABS: readonly NotificationInboxTab[] = ["unread", "all", "dismissed"];

/**
 * How the list can be carved up, in the order offered.
 *
 * Date leads because the first question is usually "what is new". Source
 * separates the reader's own work from platform news, and Type says what
 * happened, using the same words as the Type filter.
 */
const GROUPINGS = {
  date: "Date",
  source: "Source",
  type: "Type",
} as const;

type Grouping = keyof typeof GROUPINGS;

/** The splits, pinned to this list's row type. */
type Split = (
  rows: readonly InAppNotificationView[],
) => Array<{ group: string; items: InAppNotificationView[] }>;

const GROUP_BY: Record<Grouping, Split> = {
  date: groupByDay,
  source: groupByOrigin,
  type: groupByAction,
};

const EMPTY: NotificationInboxResponse = {
  notifications: [],
  facets: {
    everything: 0,
    needs_attention: 0,
    mentions: 0,
    by_action: {},
  by_origin: {},
    by_entity: [],
  },
  filter: EMPTY_NOTIFICATION_FILTER,
  total: 0,
  counts: { unread: 0, all: 0, dismissed: 0 },
  preferences: { muted_entity_slugs: [] },
};

function unwrap<T>(value: unknown, fallback: T): T {
  const body = value as { data?: T } | null;
  return (body?.data ?? fallback) as T;
}

/** Every active dimension becomes its own parameter, so the filter is shareable. */
function filterToQuery(filter: NotificationInboxFilter): string[] {
  return [
    filter.entity ? `entity=${encodeURIComponent(filter.entity)}` : "",
    filter.actions.length > 0
      ? `types=${filter.actions.map(encodeURIComponent).join(",")}`
      : "",
    filter.important ? "important=1" : "",
    filter.tagged ? "tagged=1" : "",
    filter.origin ? `origin=${filter.origin}` : "",
  ].filter(Boolean);
}

/** Entity slugs present in a selection, for the Mute action. */
function selectedEntities(
  data: NotificationInboxResponse,
  selected: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      data.notifications
        .filter((row) => selected.has(row.id) && row.entity_slug)
        .map((row) => row.entity_slug as string),
    ),
  ];
}

/**
 * The notification page.
 *
 * Two views: an Inbox of individual notifications filtered by the left rail,
 * and Watching — the entities this person watches, which is where
 * notifications come from in the first place and where each one's Webex
 * delivery is set.
 */
export function NotificationInbox() {
  const { toast } = useToast();
  const params = useSearchParams();
  const [view, setView] = React.useState<NotificationPageView>("inbox");
  // Arriving from a space's own page means arriving with a question about
  // that space, so a link may say which one and which slice to open on. Only
  // the starting point: the filter bar owns it from here, and changing it
  // does not rewrite the URL.
  const [tab, setTab] = React.useState<NotificationInboxTab>(() =>
    INBOX_TABS.includes(params.get("tab") as NotificationInboxTab)
      ? (params.get("tab") as NotificationInboxTab)
      : "unread",
  );
  const [filter, setFilter] = React.useState<NotificationInboxFilter>(() => {
    const entity = params.get("entity")?.trim();
    return entity
      ? { ...EMPTY_NOTIFICATION_FILTER, entity }
      : EMPTY_NOTIFICATION_FILTER;
  });
  const [data, setData] = React.useState<NotificationInboxResponse>(EMPTY);
  const [followTree, setFollowTree] = React.useState<FollowTreeData>(
    EMPTY_FOLLOW_TREE,
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  /**
   * How the list is carved up. By date by default, because the first
   * question is usually "what is new"; by source when the reader wants their
   * own work separated from platform news.
   */
  const [grouping, setGrouping] = React.useState<Grouping>("date");
  /** Section headings the reader has folded away, by name. */
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  /**
   * A fold belongs to the list it was made on, so changing what is in the
   * list unfolds everything. Otherwise filtering down to a section that
   * happened to be folded would answer with a blank page.
   */
  const changeList = <T,>(apply: (value: T) => void) => (value: T) => {
    setCollapsed(new Set());
    apply(value);
  };
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const query = [`tab=${tab}`, ...filterToQuery(filter)].join("&");
      const [inboxResponse, followingResponse] = await Promise.all([
        fetch(`/api/notifications/inbox?${query}`, { cache: "no-store" }),
        fetch("/api/notifications/following", { cache: "no-store" }),
      ]);
      if (!inboxResponse.ok) throw new Error(`inbox ${inboxResponse.status}`);
      setData(unwrap(await inboxResponse.json(), EMPTY));
      if (followingResponse.ok) {
        setFollowTree(
          unwrap<FollowTreeData>(
            await followingResponse.json(),
            EMPTY_FOLLOW_TREE,
          ),
        );
      }
      // A row that just left the current filter should not stay selected and
      // silently take part in the next bulk action.
      setSelected(new Set());
    } catch {
      toast("Could not load notifications", "error");
    } finally {
      setLoading(false);
    }
  }, [filter, tab, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const mutate = React.useCallback(
    async (path: string, body: unknown, failure: string) => {
      setBusy(true);
      try {
        const response = await fetch(path, {
          method: path.endsWith("/preferences") ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`${path} ${response.status}`);
        await load();
        window.dispatchEvent(new Event("in-app-notifications:refresh"));
        return true;
      } catch {
        toast(failure, "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, toast],
  );

  /**
   * Opening a row is reading it, so the dot goes.
   *
   * Not routed through `act`: that awaits the write before reloading, and
   * the click is usually a navigation away from here. `keepalive` lets the
   * mark survive the page unloading; the reload only matters when the link
   * opened elsewhere and this list is still on screen.
   */
  const openRow = (id: string) => {
    void fetch(`/api/notifications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      keepalive: true,
    })
      .then(() => load())
      .catch(() => undefined);
  };

  const act = (ids: string[], change: { read?: boolean; dismissed?: boolean }) =>
    ids.length > 0 &&
    mutate("/api/notifications/bulk", { ids, ...change }, "Could not update notifications");

  // Ticking a BHAG means ticking everything inside it, which is one request
  // rather than one per entity — the tree sends the whole subtree at once.
  const setFollowing = (slugs: string[], following: boolean) =>
    mutate(
      "/api/notifications/following",
      { slugs, following },
      following ? "Could not start watching" : "Could not stop watching",
    );

  const setMuted = (slugs: string[], muted: boolean) =>
    mutate(
      "/api/notifications/preferences",
      { mute_entity_slugs: slugs, muted },
      muted ? "Could not mute" : "Could not unmute",
    );

  const ids = data.notifications.map((row) => row.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const selectedIds = [...selected];
  const muteTargets = selectedEntities(data, selected);

  const grouped = GROUP_BY[grouping](data.notifications);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-6">
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          {/* Two places, not two filters, so they get the app's standard tab
              header: what has arrived, and what it arrives about. */}
          <Tabs
            value={view}
            onValueChange={(next) => setView(next as NotificationPageView)}
          >
            <TabsList className="h-9">
              <TabsTrigger value="inbox">Inbox</TabsTrigger>
              <TabsTrigger value="following" data-tour="notifications-watching">
                Watching
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Offered here because this is the page someone lands on when they
            want to know how any of this works, and the walkthrough starts
            with the bell above it. */}
        <TourStartButton />
      </header>

      {view === "following" ? (
        <NotificationFollowTree
          tree={followTree}
          busy={busy}
          onFollowChange={(slugs, follow) => void setFollowing(slugs, follow)}
          onMuteChange={(slug, muted) => void setMuted([slug], muted)}
        />
      ) : (
        <div className="space-y-3">
          <NotificationFilterBar
            facets={data.facets}
            filter={filter}
            onFilterChange={changeList(setFilter)}
            tab={tab}
            onTabChange={changeList(setTab)}
            counts={data.counts}
            trailing={
              <FilterDropdown
                label="Group by"
                value={GROUPINGS[grouping]}
              // Never drawn as "active": a group-by always has a value, so
              // there is no unset state for one to stand out against. The
              // filters beside it light up because they can be off.
              active={false}
                align="end"
              >
                {(Object.keys(GROUPINGS) as Grouping[]).map((value) => (
                  <FilterOption
                    key={value}
                    label={GROUPINGS[value]}
                    active={grouping === value}
                    onClick={() => changeList(setGrouping)(value)}
                  />
                ))}
              </FilterDropdown>
            }
          />

          <div className="min-w-0 flex-1 space-y-3">

            {/* Select all heads the rows' own checkbox column rather than
                joining the buttons on the right: the transparent border and
                matching padding put it on the same vertical line as the boxes
                it governs. The operations appear once there is a selection,
                since every one of them acts on it. */}
            <div className="flex min-h-9 flex-wrap items-center gap-3 border border-transparent px-3">
              <SelectionCheckbox
                checked={allSelected}
                indeterminate={selectedIds.length > 0 && !allSelected}
                onCheckedChange={(next) =>
                  setSelected(next ? new Set(ids) : new Set())
                }
                label={
                  selectedIds.length > 0 ? "Clear selection" : "Select all notifications"
                }
                disabled={ids.length === 0}
              />
              <span className="text-xs text-foreground/70">
                {selectedIds.length > 0
                  ? `${selectedIds.length} selected`
                  : // The tally heads the results rather than the filter bar,
                    // because it describes what is below it: these rows, as
                    // currently narrowed.
                    `Select all · ${data.facets.everything} unread`}
              </span>


              {selectedIds.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    disabled={busy}
                    onClick={() => void act(selectedIds, { read: true })}
                  >
                    <MailOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    Mark read
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    disabled={busy}
                    onClick={() =>
                      void act(selectedIds, { dismissed: tab !== "dismissed" })
                    }
                  >
                    {tab === "dismissed" ? (
                      <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {tab === "dismissed" ? "Restore" : "Dismiss"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    disabled={busy || muteTargets.length === 0}
                    title={
                      muteTargets.length === 0
                        ? "Select notifications from a project to mute it"
                        : `Mute ${muteTargets.join(", ")}`
                    }
                    onClick={() => void setMuted(muteTargets, true)}
                  >
                    <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                    Mute project
                  </Button>
                </div>
              )}
            </div>

            {loading ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Loading notifications…
              </p>
            ) : data.notifications.length === 0 ? (
              <EmptyInbox
                tab={tab}
                filtered={!isEmptyNotificationFilter(filter)}
                onClearFilter={() => changeList(setFilter)(EMPTY_NOTIFICATION_FILTER)}
              />
            ) : (
              <div className="space-y-5">
                {grouped.map(({ group, items }) => (
                  <section key={group} className="space-y-2">
                    <h2>
                      <button
                        type="button"
                        aria-expanded={!collapsed.has(group)}
                        onClick={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (!next.delete(group)) next.add(group);
                            return next;
                          })
                        }
                        className="group flex items-center gap-1 rounded text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            !collapsed.has(group) && "rotate-90",
                          )}
                        />
                        {group}
                        <span className="tabular-nums text-foreground/60">
                          {items.length}
                        </span>
                      </button>
                    </h2>
                    <ul
                      className={cn("space-y-2", collapsed.has(group) && "hidden")}
                    >
                      {items.map((notification) => (
                        <NotificationRow
                          key={notification.id}
                          notification={notification}
                          busy={busy}
                          selected={selected.has(notification.id)}
                          onSelectedChange={(isSelected) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (isSelected) next.add(notification.id);
                              else next.delete(notification.id);
                              return next;
                            })
                          }
                          onDismiss={(id) => void act([id], { dismissed: true })}
                          onRestore={(id) => void act([id], { dismissed: false })}
                          onOpen={openRow}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
                {data.total > data.notifications.length && (
                  <p className="pt-1 text-center text-xs text-foreground/70">
                    Showing {data.notifications.length} of {data.total}.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyInbox({
  tab,
  filtered,
  onClearFilter,
}: {
  tab: NotificationInboxTab;
  filtered: boolean;
  onClearFilter: () => void;
}) {
  // "You're all caught up" would be a lie while a filter is hiding rows, and
  // it is the filter — not the inbox — the reader needs to act on.
  const copy = filtered
    ? "Nothing matches these filters."
    : tab === "dismissed"
      ? "Nothing dismissed."
      : tab === "unread"
        ? "You’re all caught up."
        : "No notifications here yet.";
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{copy}</p>
      {filtered && (
        <Button variant="outline" size="sm" onClick={onClearFilter}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
