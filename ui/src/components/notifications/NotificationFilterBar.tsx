"use client";

import {
  ChevronDown,
  FolderKanban,
  Layers,
  Target,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { CheckboxMark } from "@/components/notifications/SelectionCheckbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  EMPTY_NOTIFICATION_FILTER,
  NOTIFICATION_TYPE_FACETS,
  isEmptyNotificationFilter,
  type NotificationAction,
  type NotificationEntityFacet,
  type NotificationInboxFacets,
  type NotificationInboxFilter,
  type NotificationInboxTab,
  type NotificationOrigin,
} from "@/types/in-app-notification";

/**
 * Every way of narrowing the inbox, as a row of dropdowns above the list.
 *
 * Read / dismissed sits here with the rest rather than above the list as its
 * own tab strip: it narrows what you see in exactly the way the others do,
 * and two rows of tab-like controls stacked on each other read as a hierarchy
 * that does not exist. Tabs are reserved for Inbox vs Watching, which really
 * are different places.
 *
 * Counts are always of unread rows, so the bar keeps answering "where is my
 * unread work" even while the reader browses All or Dismissed. Within a
 * dropdown the count reflects the *other* dropdowns' selections, which is why
 * a type can read 0 once a BHAG is picked.
 */

const STATUS_LABELS: Record<NotificationInboxTab, string> = {
  unread: "Unread",
  all: "All",
  dismissed: "Dismissed",
};

/** Indent per hierarchy tier, matching the project breadcrumb. */
const ENTITY_DEPTH: Record<NotificationEntityFacet["entity_type"], number> = {
  bhag: 0,
  area: 1,
  project: 2,
};

/**
 * Same glyphs ProjectsHub uses per tier.
 *
 * The entity list is three tiers deep and indentation alone is ambiguous
 * once names wrap or a tier has one child: the glyph says which rung a row
 * is on without the reader counting pixels.
 */
const TIER_ICON: Record<NotificationEntityFacet["entity_type"], LucideIcon> = {
  bhag: Target,
  area: Layers,
  project: FolderKanban,
};

export function FilterOption({
  label,
  count,
  active,
  onClick,
  depth = 0,
  muted,
  emphasizeCount,
  /** Tier glyph, for the options that sit in a hierarchy. */
  tier,
  /** Draw a checkbox rather than a highlight, for the multi-select groups. */
  checkable,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  depth?: number;
  muted?: boolean;
  emphasizeCount?: boolean;
  tier?: NotificationEntityFacet["entity_type"];
  checkable?: boolean;
}) {
  const Tier = tier ? TIER_ICON[tier] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      role={checkable ? "checkbox" : undefined}
      aria-checked={checkable ? active : undefined}
      aria-pressed={checkable ? undefined : active}
      style={depth > 0 ? { paddingLeft: `${0.5 + depth * 0.75}rem` } : undefined}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {checkable ? <CheckboxMark checked={active} /> : null}
      {Tier ? (
        // One colour for all three: the shapes already separate the tiers,
        // and a palette here would compete with the importance red.
        <Tier className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {muted ? (
        <VolumeX className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Muted" />
      ) : null}
      {count === undefined ? null : (
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            count === 0
              ? "text-muted-foreground/50"
              : emphasizeCount
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * A themed select: a trigger stating the current value, and a panel of
 * options. Not a native `<select>` — the browser draws that panel itself, in
 * the system palette, which ignores the app's theme entirely.
 */
export function FilterDropdown({
  label,
  value,
  active,
  onClear,
  align = "start",
  children,
}: {
  label: string;
  /** The current selection, shown on the trigger so the bar states itself. */
  value?: string;
  active: boolean;
  onClear?: () => void;
  /** `end` for a trigger near the right edge, where a panel would overflow. */
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 max-w-[16rem] items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
            // `border-input` is what every other outlined control in the
            // platform uses. A brighter edge here made the filter bar the
            // loudest thing on the page; the label and chevron identify the
            // control, so the boundary does not have to shout to do it.
            // Selected state stays obvious: a foreground edge plus a tint.
            active
              ? "border-foreground bg-primary/10 text-foreground"
              : "border-input bg-background text-muted-foreground hover:bg-muted/50",
          )}
        >
          <span className={cn(value && "text-muted-foreground")}>{label}</span>
          {value ? (
            <span className="truncate font-medium text-foreground">{value}</span>
          ) : null}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-1">
        <div className="max-h-80 space-y-0.5 overflow-y-auto">{children}</div>
        {onClear && active ? (
          <div className="mt-1 border-t pt-1">
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              Clear {label.toLowerCase()}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The TOME / Platform switch, as segments rather than another dropdown.
 *
 * It is the one cut readers make constantly — "show me my work" versus "show
 * me the platform" — and a dropdown costs two clicks and hides the current
 * answer behind a label. Three segments show the state and change it in one.
 */
function OriginQuickFilter({
  facets,
  value,
  onChange,
}: {
  facets: NotificationInboxFacets;
  value: NotificationOrigin | null;
  onChange: (origin: NotificationOrigin | null) => void;
}) {
  const segments: Array<{
    origin: NotificationOrigin | null;
    label: string;
    count: number;
  }> = [
    { origin: null, label: "All", count: facets.everything },
    { origin: "tome", label: "TOME", count: facets.by_origin.tome ?? 0 },
    {
      origin: "platform",
      label: "Platform",
      count: facets.by_origin.platform ?? 0,
    },
  ];

  return (
    <div
      role="group"
      aria-label="Source"
      // A 1px inset, so the 28px segment plus the border fills the 32px
      // height exactly. At 2px the segment overflowed and sat on the border.
      className="inline-flex h-8 items-center rounded-md border border-input bg-background p-px"
    >
      {segments.map((segment) => {
        const active = value === segment.origin;
        return (
          <button
            key={segment.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(segment.origin)}
            className={cn(
              // `rounded-sm` is `rounded-md` less the 2px inset above, so the
              // segment's corner follows the container's curve instead of
              // cutting across it. Both track `--radius`, so they stay nested
              // if the theme's roundness changes.
              "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs transition-colors",
              active
                ? "bg-primary font-medium text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {segment.label}
            <span
              className={cn(
                "tabular-nums",
                active ? "text-primary-foreground/80" : "text-foreground/60",
              )}
            >
              {segment.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function NotificationFilterBar({
  facets,
  filter,
  onFilterChange,
  tab,
  onTabChange,
  counts,
  trailing,
}: {
  facets: NotificationInboxFacets;
  filter: NotificationInboxFilter;
  onFilterChange: (filter: NotificationInboxFilter) => void;
  tab: NotificationInboxTab;
  onTabChange: (tab: NotificationInboxTab) => void;
  counts: Record<NotificationInboxTab, number>;
  /** Pinned to the right of the same row, for controls over the list. */
  trailing?: React.ReactNode;
}) {
  const patch = (next: Partial<NotificationInboxFilter>) =>
    onFilterChange({ ...filter, ...next });

  const toggleAction = (action: NotificationAction) =>
    patch({
      actions: filter.actions.includes(action)
        ? filter.actions.filter((entry) => entry !== action)
        : [...filter.actions, action],
    });

  // Only indent beneath a parent that is actually listed; an entity whose
  // parent was filtered out is shown as a root rather than pointing at a row
  // that is not there.
  const listed = React.useMemo(
    () => new Set(facets.by_entity.map((entity) => entity.entity_slug)),
    [facets.by_entity],
  );

  const selectedEntity = facets.by_entity.find(
    (entity) => entity.entity_slug === filter.entity,
  );
  // Tagged reads as a third option on the same control, so it joins the
  // others in the trigger's summary rather than sitting apart from them.
  const typeLabels = [
    ...NOTIFICATION_TYPE_FACETS.filter((facet) =>
      filter.actions.includes(facet.action),
    ).map((facet) => facet.label),
    ...(filter.tagged ? ["Tagged"] : []),
  ];

  const anyFilter = !isEmptyNotificationFilter(filter);

  return (
    <div className="flex flex-wrap items-center gap-2" data-tour="notifications-inbox">
      <OriginQuickFilter
        facets={facets}
        value={filter.origin}
        onChange={(origin) => patch({ origin })}
      />
      <span className="h-5 w-px bg-border" aria-hidden="true" />
      <FilterDropdown label="Status" value={STATUS_LABELS[tab]} active={tab !== "unread"}>
        {(Object.keys(STATUS_LABELS) as NotificationInboxTab[]).map((value) => (
          <FilterOption
            key={value}
            label={STATUS_LABELS[value]}
            count={counts[value]}
            active={tab === value}
            onClick={() => onTabChange(value)}
          />
        ))}
      </FilterDropdown>

      <FilterDropdown
        label="Type"
        value={
          typeLabels.length === 0
            ? undefined
            : typeLabels.length === 1
              ? typeLabels[0]
              : `${typeLabels.length} selected`
        }
        active={filter.actions.length > 0 || filter.tagged}
        onClear={() => patch({ actions: [], tagged: false })}
      >
        {/* Tagged first: it is the only one of the three that says the row
            was addressed to this reader by name. */}
        <FilterOption
          label="Tagged"
          count={facets.mentions}
          checkable
          active={filter.tagged}
          onClick={() => patch({ tagged: !filter.tagged })}
        />
        {NOTIFICATION_TYPE_FACETS.map(({ action, label }) => (
          <FilterOption
            key={action}
            label={label}
            count={facets.by_action[action] ?? 0}
            checkable
            active={filter.actions.includes(action)}
            onClick={() => toggleAction(action)}
          />
        ))}
      </FilterDropdown>

      {facets.by_entity.length > 0 && (
        <FilterDropdown
          label="Project"
          value={selectedEntity?.entity_title ?? filter.entity}
          active={Boolean(filter.entity)}
          onClear={() => patch({ entity: undefined })}
        >
          {facets.by_entity.map((entity) => (
            <FilterOption
              key={entity.entity_slug}
              label={entity.entity_title}
              count={entity.unread}
              muted={entity.muted}
              tier={entity.entity_type}
              depth={
                entity.parent_entity_slug && listed.has(entity.parent_entity_slug)
                  ? ENTITY_DEPTH[entity.entity_type]
                  : 0
              }
              active={filter.entity === entity.entity_slug}
              // One entity at a time: picking a BHAG already means everything
              // beneath it, so a second selection would rarely narrow usefully.
              onClick={() =>
                patch({
                  entity:
                    filter.entity === entity.entity_slug
                      ? undefined
                      : entity.entity_slug,
                })
              }
            />
          ))}
        </FilterDropdown>
      )}

      <FilterDropdown
        label="Only"
        value={filter.important ? "Important" : undefined}
        active={filter.important}
        onClear={() => patch({ important: false })}
      >
        <FilterOption
          label="Important"
          count={facets.needs_attention}
          emphasizeCount
          checkable
          active={filter.important}
          onClick={() => patch({ important: !filter.important })}
        />
      </FilterDropdown>

      {anyFilter && (
        <button
          type="button"
          onClick={() => onFilterChange(EMPTY_NOTIFICATION_FILTER)}
          className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Clear filters
        </button>
      )}

      {/* Whatever the caller puts here is pinned right, on this same row:
          narrowing the list and arranging it are both decisions about the
          list, so they share one strip rather than stacking two. */}
      {trailing && <div className="ml-auto flex items-center">{trailing}</div>}
    </div>
  );
}
