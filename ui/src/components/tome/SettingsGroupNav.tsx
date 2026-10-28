"use client";

/**
 * Two rows of tabs for a settings panel that had grown too wide for one.
 *
 * Deliberately not Radix tabs. The panel below is already one `Tabs`, keyed
 * by the values these rows select, and nesting a second `Tabs` inside it to
 * drive the first would give two components an opinion about which panel is
 * showing. These are buttons that set state; the underline is the only thing
 * they have in common with the row they replace.
 */

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  TOME_SETTINGS_GROUPS,
  subtabId,
  visibleSubtabs,
  type TomeSettingsGroup,
  type TomeSettingsSubTab,
} from "@/lib/tome/settings-nav";

/**
 * The underline a top-level settings tab is marked with.
 *
 * Shared with the Radix tabs on the TOME admin page, which are the same kind
 * of choice at the same level: a reader who learns what a settings tab looks
 * like in one place should not have to learn it again in the other.
 */
export const SETTINGS_TAB_TRIGGER_CLASS =
  "rounded-none border-b-2 border-transparent bg-transparent px-1 pb-2 pt-1 text-sm font-medium shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

export function SettingsGroupNav({
  activeGroup,
  activeTab,
  activeFocus,
  container,
  sourceKinds,
  onSelect,
}: {
  activeGroup: string;
  /** The panel showing, which decides which subtab is lit. */
  activeTab: string;
  /** Which part of a shared panel, for the groups whose subtabs share one. */
  activeFocus: string | null;
  container: boolean;
  sourceKinds: readonly string[];
  onSelect: (group: TomeSettingsGroup, subtab: TomeSettingsSubTab) => void;
}) {
  const groups = React.useMemo(
    () =>
      TOME_SETTINGS_GROUPS.map((group) => ({
        group,
        subtabs: visibleSubtabs(group, { container, sourceKinds }),
        // A group whose every subtab was filtered out has nothing to open.
      })).filter((entry) => entry.subtabs.length > 0),
    [container, sourceKinds],
  );

  const open = groups.find((entry) => entry.group.id === activeGroup) ?? groups[0];
  const selected = activeFocus ? `${activeTab}:${activeFocus}` : activeTab;

  return (
    <div>
      {/* The line closes the top row rather than the pair of them, so the
          subtabs fall on the content's side of it, which is the side they
          belong to: they choose what is in the panel, not what is in the
          header. */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex w-full items-center gap-4 overflow-x-auto overflow-y-hidden border-b border-border pb-px"
      >
        {groups.map(({ group, subtabs }) => {
          const isOpen = open?.group.id === group.id;
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={isOpen}
              // Opening a group shows its first subtab, because a group is a
              // heading rather than a page of its own.
              onClick={() => subtabs[0] && onSelect(group, subtabs[0])}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-0.5 pb-2 pt-1 text-sm font-medium transition-colors",
                isOpen
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {group.label}
            </button>
          );
        })}
      </div>

      {/* The second row is only worth drawing when there is a choice in it. */}
      {open && open.subtabs.length > 1 && (
        <div
          role="tablist"
          aria-label={`${open.group.label} settings`}
          className="flex w-full items-center gap-4 overflow-x-auto overflow-y-hidden pb-1 pl-3 pt-2.5"
        >
          {open.subtabs.map((subtab) => {
            const id = subtabId(subtab);
            const isActive = id === selected;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(open.group, subtab)}
                // Plainer than the row above it, never heavier. A filled
                // pill under a bare underline makes the smaller choice look
                // like the larger one.
                className={cn(
                  "shrink-0 whitespace-nowrap text-xs transition-colors",
                  isActive
                    ? "font-semibold text-foreground"
                    : "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {subtab.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
