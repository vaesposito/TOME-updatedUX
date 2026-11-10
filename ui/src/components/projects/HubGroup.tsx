"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A group of spaces, as the catalogue draws one.
 *
 * Two levels, and the same two on either axis: the catalogue reads BHAG →
 * Area → Project, the organisation reads Function → Category → Subject. One
 * component for both, because a reader moving between the two axes is moving
 * through the same shape, and a caret indented differently or a count set
 * differently on the other side would say they had arrived somewhere else.
 */

/** The one control that opens and closes a group. */
export function GroupCaret({
  collapsed,
  name,
  onToggle,
  level = "top",
}: {
  collapsed: boolean;
  /** Said aloud, so the control names what it opens. */
  name: string;
  onToggle: () => void;
  level?: HubGroupLevel;
}) {
  const Icon = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${name}`}
      onClick={onToggle}
      className="shrink-0 text-muted-foreground transition hover:text-foreground"
    >
      <Icon className={level === "nested" ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </button>
  );
}

export type HubGroupLevel = "top" | "nested";

/** Something rare enough to offer only on hover, beside the group's name. */
export interface HubGroupAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function HubGroup({
  level = "top",
  name,
  href,
  labelClassName,
  icon,
  count,
  meta,
  action,
  before,
  overlay,
  className,
  onDragOver,
  onDrop,
  children,
}: {
  level?: HubGroupLevel;
  /** The group's name, as shown and as said to assistive technology. */
  name: string;
  /** Where the name leads, for a group that is a space of its own. */
  href?: string;
  labelClassName?: string;
  icon?: React.ReactNode;
  count: number;
  /** Anything belonging between the name and the count, such as a parent. */
  meta?: React.ReactNode;
  action?: HubGroupAction;
  /** Before the caret: a drag handle, where the group can be reordered. */
  before?: React.ReactNode;
  /** Drawn over the group whether it is open or closed, such as a drop line. */
  overlay?: React.ReactNode;
  className?: string;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  children?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const toggle = React.useCallback(() => setCollapsed((c) => !c), []);
  const nested = level === "nested";

  return (
    <div
      className={cn(
        nested
          ? "group/area ml-4 space-y-2 border-l-2 border-sky-500/20 pl-4 sm:ml-6 sm:pl-6"
          : "group/group relative space-y-3 rounded-xl transition",
        className,
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {overlay}

      <div className={cn("flex items-center", nested ? "gap-2" : "gap-3")}>
        {before}

        <GroupCaret
          collapsed={collapsed}
          name={name}
          onToggle={toggle}
          level={level}
        />

        {icon}

        {/* The name is the way in.
            A group that has a space of its own says so by leading there,
            rather than by a second control beside this one repeating the
            name, repeating the kind the icon already gave, and saying
            "clickable" three times over in a border, a fill and a colour.
            Without one, the name does what the whole row does. */}
        {href ? (
          <Link
            href={href}
            className={cn(
              "group/name inline-flex min-w-0 items-center gap-1 hover:underline",
              labelClassName,
            )}
          >
            <span className="truncate">{name}</span>
            <ArrowRight
              className={cn(
                "shrink-0 opacity-0 transition group-hover/name:opacity-100",
                nested ? "h-3 w-3" : "h-3.5 w-3.5",
              )}
              aria-hidden
            />
          </Link>
        ) : (
          <button
            type="button"
            onClick={toggle}
            className={cn("min-w-0 truncate text-left", labelClassName)}
          >
            {name}
          </button>
        )}

        {meta}

        <span className="shrink-0 text-xs text-muted-foreground/50">{count}</span>

        {action && (
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={cn(
              "shrink-0 text-xs text-muted-foreground opacity-0 transition hover:text-foreground focus:opacity-100 disabled:opacity-50",
              nested ? "group-hover/area:opacity-100" : "group-hover/group:opacity-100",
            )}
          >
            {action.label}
          </button>
        )}

        <span
          className={cn(
            "ml-1 h-px flex-grow",
            nested ? "bg-border/30" : "bg-border/40",
          )}
        />
      </div>

      {!collapsed && children}
    </div>
  );
}
