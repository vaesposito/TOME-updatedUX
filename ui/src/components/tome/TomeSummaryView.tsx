"use client";

import { Bell, ChevronRight, CircleCheck, MessageSquare, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import {
  FilterDropdown,
  FilterOption,
} from "@/components/notifications/NotificationFilterBar";
import { AttentionMark } from "@/components/notifications/NotificationIcons";
import { UnreadDot } from "@/components/notifications/UnreadDot";
import {
  ROW_ACTION_CLASS,
  artifactLink,
  groupByAction,
  groupByDay,
  groupByOrigin,
  notificationAccent,
  notificationByline,
  notificationOrigin,
  notificationType,
} from "@/components/notifications/notification-presentation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NOTIFICATION_TYPE_FACETS } from "@/types/in-app-notification";
import {
  TOME_SUMMARY_REASON_LABELS,
  type TomeSummary,
  type TomeSummaryItem,
  type TomeSummarySection,
  type TomeSummarySectionKey,
} from "@/types/tome-summary";

/**
 * The summary: the landing view of a BHAG, Area or Project.
 *
 * It answers "what is the state of this" from the same notifications that
 * feed the inbox, grouped by what a reader would do with an item rather than
 * by when it arrived.
 */

/**
 * How the summary can be carved up, in the order offered.
 *
 * Type leads and is the default: a reader opening a space first wants to
 * know what was addressed to them, then what arrived, then what moved.
 * Section keeps the old digest shape for anyone who preferred it.
 */
const GROUPINGS = {
  type: "Type",
  section: "Section",
  date: "Date",
  source: "Source",
} as const;

type Grouping = keyof typeof GROUPINGS;

/** What the reader has narrowed the list to. Empty means everything. */
interface SummaryFilter {
  /** Type labels, matching what the rows and the Type dropdown display. */
  types: string[];
  important: boolean;
  unread: boolean;
  /** Only rows that concern the reader personally. */
  mine: boolean;
}

const NO_FILTER: SummaryFilter = {
  types: [],
  important: false,
  unread: false,
  mine: false,
};

/** The Type dropdown's options, Tagged first, as on the notifications page. */
const TYPE_LABELS = ["Tagged", ...NOTIFICATION_TYPE_FACETS.map((f) => f.label)];

/**
 * Whether a row concerns the reader rather than merely the space.
 *
 * Being tagged, being sent it, or following where it happened all count; a
 * row that is simply in scope does not. This is the same test the server
 * applies for its `for_me` scope, done here so that narrowing to it is one
 * more filter rather than a second, separate way of narrowing.
 */
function concernsReader(item: TomeSummaryItem): boolean {
  return (
    item.reason === "mentioned" ||
    item.reason === "addressed" ||
    item.reason === "watching"
  );
}

function matches(item: TomeSummaryItem, filter: SummaryFilter): boolean {
  if (filter.mine && !concernsReader(item)) return false;
  if (filter.important && !(item.needs_attention || item.severity === "error")) {
    return false;
  }
  if (filter.unread && item.read) return false;
  if (filter.types.length === 0) return true;
  return filter.types.includes(typeOf(item));
}

/** A row's type, with mentions resolved from the summary's own reason. */
function typeOf(item: TomeSummaryItem): string {
  return notificationType({ ...item, mentioned: item.reason === "mentioned" });
}

function entityNoun(type: string): string {
  if (type === "bhag") return "BHAG";
  if (type === "area") return "Area";
  return "Project";
}

/** "Open 5 days" reads oddly on the day something is raised. */
function openFor(days: number): string {
  if (days <= 0) return "Opened today";
  return `Open ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * One row of a summary, laid out exactly like a row of the inbox.
 *
 * Read top to bottom: where it came from, what happened, which project, and
 * when; then the headline; then what it says; then what you can do about it.
 * A notification should not rearrange itself depending on which surface a
 * reader happens to be looking at.
 */
function SummaryRow({
  item,
  showEntity,
  viewing,
  onDismiss,
  onOpen,
  busy,
}: {
  item: TomeSummaryItem;
  /** Hidden on a Project's own summary, where every row is the same entity. */
  showEntity: boolean;
  viewing: string;
  onDismiss: (item: TomeSummaryItem) => void;
  /** Following the link is what "I have seen this" means, so it clears the dot. */
  onOpen: (item: TomeSummaryItem) => void;
  busy: boolean;
}) {
  const urgent = !item.resolved && (item.needs_attention || item.severity === "error");
  const target = artifactLink(item, viewing);
  const mentioned = item.reason === "mentioned";
  const origin = notificationOrigin(item);
  const type = notificationType({ ...item, mentioned });
  const reason = TOME_SUMMARY_REASON_LABELS[item.reason];
  const byline = notificationByline({ ...item, mentioned });

  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 transition-colors",
        urgent
          ? "border-destructive/50 bg-destructive/5"
          : item.resolved
            ? "border-border bg-muted/30"
            : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {/* Beside the whole block, as in the inbox: one left margin per row,
            and the same dot in the same place wherever a notification is
            shown. Resolved rows never carry it — settled is not unread. */}
        <UnreadDot
          unread={!item.read && !item.resolved}
          className="mt-[0.4375rem]"
        />

        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate text-xs">
            {/* Which product the row came from, said plainly, exactly as
                the inbox says it. */}
            <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/70">
              {origin}
            </span>
            <span className={cn("font-medium", notificationAccent(item))}>
              {type}
            </span>
            {showEntity && item.entity_title && (
              <span className="text-foreground/70">
                {" · "}
                {item.entity_title}
              </span>
            )}
            {/* Why this row reached the reader at all — the one thing a
                summary says that an inbox row does not. */}
            {reason && <span className="text-foreground/70">{" · "}{reason}</span>}
            {/* The reference joins the breadcrumb, as it does in the
                inbox: it names which release or issue this concerns. */}
            {item.reference && (
              <span className="text-foreground/70">{" · "}{item.reference}</span>
            )}
          </p>

          <p
            className={cn(
              "mt-0.5 text-sm leading-snug",
              // Resolved rows stay legible rather than greyed out: settled is
              // not the same as irrelevant, and dimming them was reading as
              // "ignore me".
              item.resolved ? "font-medium" : "font-semibold",
            )}
          >
            {item.title}
          </p>
          {byline && (
            <p className="mt-0.5 text-xs text-foreground/80">{byline.text}</p>
          )}
        </div>
      </div>

      {/* Every action a row has, on one line, in the same order as the
          inbox. Watching is absent on purpose — it is a standing choice
          about an entity rather than a response to one item, and it
          belongs on the entity and in the Watching tab.

          Beside the text rather than beneath it, as in the inbox: stacked,
          two buttons that are identical on every row were costing each one a
          third of its height. */}
      <div className="ml-auto flex shrink-0 items-center gap-2 self-center">
        {!item.resolved && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={ROW_ACTION_CLASS}
            disabled={busy}
            onClick={() => onDismiss(item)}
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </Button>
        )}
        {target && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={ROW_ACTION_CLASS}
            asChild
          >
            <Link
              href={target.href}
              {...(target.external
                ? { target: "_blank", rel: "noreferrer noopener" }
                : {})}
              aria-label={target.aria}
              onClick={() => {
                if (!item.read) onOpen(item);
              }}
            >
              {target.label}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        )}

        {/* Against the row's own right edge, as in the inbox. Wider than the
            inbox's column because an age spells itself out where a date does
            not, and a resolved row says so here rather than in the
            breadcrumb — it is the same fact as "how long has this been
            open". */}
        <span className="w-[5.5rem] shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-foreground/70">
          {item.resolved ? "Resolved" : openFor(item.open_days)}
        </span>

        {/* Outermost, on the age's own line, as in the inbox — and the slot
            stays open on rows without a mark so the ages stay in line. */}
        <span className="flex w-3.5 shrink-0 justify-end">
          <AttentionMark notification={{ ...item, mentioned }} />
        </span>
      </div>
    </li>
  );
}

/**
 * Split the rows the way the reader asked.
 *
 * Section is the summary's own dimension — the digest buckets the server
 * sorted rows into — so it is built here; the other three are the same
 * splits the notifications page uses, shared rather than reimplemented.
 */
function split(
  sections: readonly TomeSummarySection[],
  rows: readonly TomeSummaryItem[],
  grouping: Grouping,
): Array<{
  group: string;
  description?: string;
  /** Present only when split by section, where the bucket has an identity. */
  key?: TomeSummarySectionKey;
  items: TomeSummaryItem[];
}> {
  if (grouping !== "section") {
    const by =
      grouping === "type"
        ? groupByAction
        : grouping === "date"
          ? groupByDay
          : groupByOrigin;
    // The mention flag is the summary's `reason` under another name, which
    // the shared splits have no way to know.
    const tagged = rows.map((row) => ({
      ...row,
      mentioned: row.reason === "mentioned",
    }));
    return by(tagged).map(({ group, items }) => ({ group, items }));
  }

  const kept = new Set(rows.map((row) => row.id));
  return sections
    .map((section) => ({
      group: section.title,
      description: section.description,
      key: section.key,
      items: section.items.filter((item) => kept.has(item.id)),
    }))
    .filter((section) => section.items.length > 0);
}

function SummarySection({
  group,
  description,
  sectionKey,
  items,
  showEntity,
  viewing,
  onDismiss,
  onOpen,
  busy,
}: {
  group: string;
  description?: string;
  sectionKey?: TomeSummarySectionKey;
  items: readonly TomeSummaryItem[];
  showEntity: boolean;
  viewing: string;
  onDismiss: (item: TomeSummaryItem) => void;
  onOpen: (item: TomeSummaryItem) => void;
  busy: boolean;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">
          {group}{" "}
          <span className="font-normal tabular-nums text-foreground/60">
            {items.length}
          </span>
        </h3>
        {description && <p className="text-xs text-foreground/70">{description}</p>}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <SummaryRow
            key={item.id}
            item={item}
            // Elsewhere is by definition about other entities, so it names
            // them even on a Project's summary where every other row is the
            // Project itself.
            showEntity={showEntity || sectionKey === "elsewhere"}
            viewing={viewing}
            onDismiss={onDismiss}
            onOpen={onOpen}
            busy={busy}
          />
        ))}
      </ul>
    </section>
  );
}

export function TomeSummaryView({
  slug,
  onOpenAgent,
}: {
  slug: string;
  /** Lets the host shell switch panes rather than reload the route. */
  onOpenAgent?: () => void;
}) {
  const [grouping, setGrouping] = React.useState<Grouping>("type");
  const [filter, setFilter] = React.useState<SummaryFilter>(NO_FILTER);
  const [summary, setSummary] = React.useState<TomeSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      // Always the whole space. Narrowing it to the reader is a filter now,
      // applied here, so switching to it does not cost a round trip and the
      // counts on the other filters keep describing the same list.
      const response = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/summary?scope=all`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`Summary returned ${response.status}`);
      const body = await response.json();
      setSummary((body?.data ?? body) as TomeSummary);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /**
   * Opening a row is reading it, so the dot goes.
   *
   * Fire-and-forget with `keepalive`, because the click is usually a
   * navigation and the request has to outlive the page. The local flip is
   * what clears the dot now; reloading the whole summary mid-navigation
   * would only be work the reader never sees.
   */
  const open = (item: TomeSummaryItem) => {
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
  };

  const dismiss = async (item: TomeSummaryItem) => {
    setBusy(true);
    try {
      await fetch("/api/notifications/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [item.id], dismissed: true }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading && !summary) {
    return (
      <div className="px-6 py-16 text-center text-sm text-muted-foreground">
        Loading the summary…
      </div>
    );
  }

  if (failed || !summary) {
    return (
      <div className="px-6 py-16 text-center text-sm text-muted-foreground">
        The summary is unavailable right now.
      </div>
    );
  }

  const noun = entityNoun(summary.entity.type);
  // A Project's rows are all about the Project itself, so repeating its name
  // on every line says nothing. Above that, the name is the whole point.
  const showEntity = summary.entity.type !== "project";
  // One flat list behind every split, so a filter means the same thing
  // whichever way the page is currently arranged.
  const rows = summary.sections.flatMap((section) => section.items);
  const visible = rows.filter((row) => matches(row, filter));
  const groups = split(summary.sections, visible, grouping);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header className="space-y-3" data-tour="project-summary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Just what the page is. The breadcrumb above already names the
              entity, and the old heading said it twice more — once in an
              eyebrow and once inside a generated sentence — before getting
              to anything the reader did not already know. */}
          {/* Named for the question it answers, and deliberately without the
              entity's name or tier: the breadcrumb above already says which
              space this is, and the same words have to work for a BHAG, an
              Area and a Project. "Activity" was unavailable — the nav uses
              it for a different pane. */}
          <h2 className="text-2xl font-bold tracking-tight">What&apos;s new</h2>
          {/* Actions, not tabs. They used to share a baseline with the scope
              tabs, which made three buttons look like part of a set they had
              nothing to do with. */}
          <div className="flex items-center gap-2">
            {/* No Watch here. Watching is a property of the space, and the
                entity header already offers it; a second copy on the digest
                made the same subscription look like two. */}
            {/* Outlined and iconned to match the page chrome's controls. As ghost
                buttons these read as a line of prose in the header rather
                than as three things you can press. */}
            {onOpenAgent && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto gap-1.5 px-2 py-1"
                onClick={onOpenAgent}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Ask the agent
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto gap-1.5 px-2 py-1"
              asChild
            >
              <Link href="/notifications">
                <Bell className="h-3.5 w-3.5" />
                Notifications
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* The same controls as the notifications page, in the same order and
          built from the same pieces: narrowing on the left, arranging pinned
          right. A summary is a view of notifications, so it should be
          adjustable the same way. */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterDropdown
          label="Type"
          value={
            filter.types.length === 0
              ? undefined
              : filter.types.length === 1
                ? filter.types[0]
                : `${filter.types.length} selected`
          }
          active={filter.types.length > 0}
          onClear={() => setFilter({ ...filter, types: [] })}
        >
          {TYPE_LABELS.map((label) => (
            <FilterOption
              key={label}
              label={label}
              count={rows.filter((row) => typeOf(row) === label).length}
              checkable
              active={filter.types.includes(label)}
              onClick={() =>
                setFilter({
                  ...filter,
                  types: filter.types.includes(label)
                    ? filter.types.filter((entry) => entry !== label)
                    : [...filter.types, label],
                })
              }
            />
          ))}
        </FilterDropdown>

        <FilterDropdown
          label="Only"
          value={
            [
              filter.mine && "Concerns me",
              filter.important && "Important",
              filter.unread && "Unread",
            ]
              .filter(Boolean)
              .join(", ") || undefined
          }
          active={filter.mine || filter.important || filter.unread}
          onClear={() =>
            setFilter({ ...filter, mine: false, important: false, unread: false })
          }
        >
          {/* What used to be the "For me" tab. It narrows the same list by the
              same kind of test as the two below it, so it belongs beside them
              rather than in a tab strip of its own. */}
          <FilterOption
            label="Concerns me"
            count={rows.filter(concernsReader).length}
            checkable
            active={filter.mine}
            onClick={() => setFilter({ ...filter, mine: !filter.mine })}
          />
          <FilterOption
            label="Important"
            count={
              rows.filter((row) => row.needs_attention || row.severity === "error")
                .length
            }
            checkable
            active={filter.important}
            onClick={() => setFilter({ ...filter, important: !filter.important })}
          />
          <FilterOption
            label="Unread"
            count={rows.filter((row) => !row.read).length}
            checkable
            active={filter.unread}
            onClick={() => setFilter({ ...filter, unread: !filter.unread })}
          />
        </FilterDropdown>

        <div className="ml-auto">
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
                onClick={() => setGrouping(value)}
              />
            ))}
          </FilterDropdown>
        </div>
      </div>

      {summary.counts.recently_resolved > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-foreground/70">
          <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            Last 30 days: {summary.counts.recently_resolved} resolved
          </span>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="text-sm font-medium">Nothing to report</p>
          <p className="mt-1 text-xs text-foreground/70">
            {/* An empty space and an over-narrowed one are different
                problems, and only one of them is the reader's to fix. */}
            {rows.length > 0
              ? "No items match these filters."
              : `No activity has been recorded in this ${noun} yet.`}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <SummarySection
              key={group.group}
              group={group.group}
              description={group.description}
              sectionKey={group.key}
              items={group.items}
              showEntity={showEntity}
              viewing={slug}
              onDismiss={dismiss}
              onOpen={open}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
