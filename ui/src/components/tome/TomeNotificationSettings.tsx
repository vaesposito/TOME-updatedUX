"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SelectionCheckbox } from "@/components/notifications/SelectionCheckbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CADENCES,
  CHANNELS,
  HOURS,
  SPACE_LEVELS,
  channelsLabel,
  defaultPreferences,
  localTimezone,
  sharedValue,
  spacePreference,
  timezoneOptions,
  type Cadence,
  type Channel,
  type SpaceLevel,
  type SpacePreference,
  type TomeNotificationPreferences,
} from "@/lib/tome/notification-preferences";
import type { NotificationFollowTreeNode } from "@/types/in-app-notification";
import { cn } from "@/lib/utils";

interface TreeItem {
  node: NotificationFollowTreeNode;
  depth: number;
  children: TreeItem[];
  /** This node and everything beneath it, so a parent can set a whole branch. */
  slugs: string[];
}

/** Rebuild the shape from the flat, depth-first list the server sends. */
function buildTree(nodes: readonly NotificationFollowTreeNode[]): TreeItem[] {
  const items = new Map<string, TreeItem>(
    nodes.map((node) => [node.slug, { node, depth: 0, children: [], slugs: [node.slug] }]),
  );
  const roots: TreeItem[] = [];
  for (const node of nodes) {
    const item = items.get(node.slug);
    if (!item) continue;
    const parent = node.parent_slug ? items.get(node.parent_slug) : undefined;
    if (parent) {
      item.depth = parent.depth + 1;
      parent.children.push(item);
    } else {
      roots.push(item);
    }
  }
  for (const node of [...nodes].reverse()) {
    const item = items.get(node.slug);
    if (!item) continue;
    item.slugs = [node.slug, ...item.children.flatMap((child) => child.slugs)];
  }
  return roots;
}

/**
 * The three controls that appear on every row and in the header: how much,
 * where, and how often.
 *
 * A header shows "Mixed" when the rows beneath it disagree, so a reader can
 * see a column is not uniform before they overwrite it.
 */
function RowControls({
  value,
  mixed,
  disabled,
  labelSuffix,
  onChange,
}: {
  value: SpacePreference;
  /** Which columns are showing several different values at once. */
  mixed?: { level?: boolean; channels?: boolean; cadence?: boolean };
  disabled?: boolean;
  /** Distinguishes one row's controls from another's for a screen reader. */
  labelSuffix: string;
  onChange: (next: Partial<SpacePreference>) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Select
        aria-label={`How much to hear about ${labelSuffix}`}
        className="h-7 w-[7.5rem] text-xs"
        disabled={disabled}
        value={mixed?.level ? "" : value.level}
        onChange={(event) => onChange({ level: event.target.value as SpaceLevel })}
      >
        {mixed?.level && <option value="">Mixed</option>}
        {SPACE_LEVELS.map((level) => (
          <option key={level.id} value={level.id}>{level.label}</option>
        ))}
      </Select>

      <Select
        aria-label={`Where to be told about ${labelSuffix}`}
        className="h-7 w-[7.5rem] text-xs"
        disabled={disabled}
        value={mixed?.channels ? "" : value.channels.join(",")}
        onChange={(event) => onChange({
          channels: event.target.value ? (event.target.value.split(",") as Channel[]) : [],
        })}
      >
        {mixed?.channels && <option value="">Mixed</option>}
        <option value="bell">App bell</option>
        <option value="bell,webex">App bell, Webex</option>
        <option value="webex">Webex</option>
        <option value="">Off</option>
      </Select>

      <Select
        aria-label={`How often to be told about ${labelSuffix}`}
        className="h-7 w-[7.5rem] text-xs"
        disabled={disabled}
        value={mixed?.cadence ? "" : value.cadence}
        onChange={(event) => onChange({ cadence: event.target.value as Cadence })}
      >
        {mixed?.cadence && <option value="">Mixed</option>}
        {CADENCES.map((cadence) => (
          <option key={cadence.id} value={cadence.id}>{cadence.label}</option>
        ))}
      </Select>
    </div>
  );
}

function SpaceRow({
  item,
  followed,
  preferences,
  onFollowChange,
  onSpaceChange,
}: {
  item: TreeItem;
  followed: ReadonlySet<string>;
  preferences: TomeNotificationPreferences;
  onFollowChange: (slugs: string[], following: boolean) => void;
  onSpaceChange: (slugs: string[], next: Partial<SpacePreference>) => void;
}) {
  const [open, setOpen] = useState(true);
  const { node, children, depth, slugs } = item;
  const inBranch = slugs.filter((slug) => followed.has(slug));
  const allFollowed = inBranch.length === slugs.length;
  const value = spacePreference(preferences, node.slug);
  const branch = slugs.map((slug) => spacePreference(preferences, slug));

  return (
    <>
      <li>
        <div
          className="flex items-center gap-2 py-1 pl-2 pr-2 transition-colors hover:bg-muted/50"
          style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
        >
          {children.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${node.title}`}
              className="shrink-0"
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
              />
            </button>
          ) : (
            <span aria-hidden className="w-3.5 shrink-0" />
          )}

          <SelectionCheckbox
            checked={allFollowed}
            indeterminate={inBranch.length > 0 && !allFollowed}
            onCheckedChange={(next) => onFollowChange(slugs, next)}
            label={`Follow ${node.title}`}
          />

          <span className="min-w-0 flex-1 truncate text-sm">{node.title}</span>

          <RowControls
            value={value}
            mixed={children.length > 0 ? {
              level: sharedValue(branch.map((entry) => entry.level)) === null,
              channels: sharedValue(branch.map((entry) => channelsLabel(entry.channels))) === null,
              cadence: sharedValue(branch.map((entry) => entry.cadence)) === null,
            } : undefined}
            disabled={inBranch.length === 0}
            labelSuffix={node.title}
            // Setting a parent sets everything under it: a reader who turns a
            // BHAG down means the projects in it, not the BHAG's own handful
            // of pages.
            onChange={(next) => onSpaceChange(slugs, next)}
          />
        </div>
      </li>
      {open && children.map((child) => (
        <SpaceRow
          key={child.node.slug}
          item={child}
          followed={followed}
          preferences={preferences}
          onFollowChange={onFollowChange}
          onSpaceChange={onSpaceChange}
        />
      ))}
    </>
  );
}

/**
 * A reader's TOME notification preferences: what they hear, where it lands,
 * when it arrives, and the per-space exceptions to all three.
 *
 * None of it is stored yet, and none of it changes what the pipeline sends.
 * The controls are here to be looked at and agreed on; the panel says so
 * rather than showing a Save that would quietly do nothing.
 */
export function TomeNotificationSettings() {
  const [nodes, setNodes] = useState<NotificationFollowTreeNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<TomeNotificationPreferences>(
    () => defaultPreferences(localTimezone()),
  );
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch("/api/notifications/following", { cache: "no-store" });
        if (!response.ok) throw new Error(`following ${response.status}`);
        const body = await response.json();
        const tree = (body?.data ?? body)?.nodes ?? [];
        if (cancelled) return;
        setNodes(tree);
        setFollowed(new Set(
          (tree as NotificationFollowTreeNode[])
            .filter((node) => node.following)
            .map((node) => node.slug),
        ));
      } catch {
        if (!cancelled) {
          setNodes([]);
          setLoadError("Could not load your spaces. The rest of this page still works.");
        }
      }
    };
    void read();
    return () => { cancelled = true; };
  }, []);

  const roots = useMemo(() => buildTree(nodes ?? []), [nodes]);
  const allSlugs = useMemo(() => (nodes ?? []).map((node) => node.slug), [nodes]);
  const allFollowed = allSlugs.length > 0 && followed.size === allSlugs.length;

  const setFollowing = useCallback((slugs: string[], following: boolean) => {
    setFollowed((current) => {
      const next = new Set(current);
      for (const slug of slugs) {
        if (following) next.add(slug);
        else next.delete(slug);
      }
      return next;
    });
  }, []);

  const setSpaces = useCallback((slugs: string[], patch: Partial<SpacePreference>) => {
    setPreferences((current) => {
      const spaces = { ...current.spaces };
      for (const slug of slugs) {
        spaces[slug] = { ...spacePreference(current, slug), ...patch };
      }
      return { ...current, spaces };
    });
  }, []);

  const everySpace = useMemo(
    () => allSlugs.map((slug) => spacePreference(preferences, slug)),
    [allSlugs, preferences],
  );

  const quiet = preferences.quietHours;
  const zones = timezoneOptions(quiet.timezone);
  const off = !preferences.enabled;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Switch
          checked={preferences.enabled}
          onCheckedChange={(next) => setPreferences((current) => ({ ...current, enabled: next }))}
          aria-label="Send me notifications"
        />
        <span className="text-sm font-medium">Send me notifications</span>
      </div>

      {/* inert rather than a dimmed overlay: with notifications off these
          controls decide nothing, and leaving them reachable by keyboard
          would let someone set a preference that is not being consulted. */}
      <div className={cn("space-y-6", off && "opacity-50")} inert={off}>
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">What type of notifications?</h3>
          <div role="radiogroup" aria-label="What type of notifications?" className="space-y-2">
            {SPACE_LEVELS.filter((level) => level.id !== "off").map((level) => (
              <label key={level.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="tome-notification-level"
                  checked={preferences.level === level.id}
                  onChange={() => setPreferences((current) => ({ ...current, level: level.id }))}
                  className="h-4 w-4 accent-primary"
                />
                <span className="font-medium">{level.label}</span>
                <span className="text-xs text-muted-foreground">{level.hint}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Where would you like to be notified?</h3>
          {CHANNELS.map((channel) => {
            // Webex has nothing behind it until an account is connected, so
            // the row says why rather than failing when it is ticked.
            const unavailable = channel.id === "webex";
            return (
              <div key={channel.id} className="space-y-1">
                <label className={cn("flex items-center gap-2 text-sm", unavailable ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                  <input
                    type="checkbox"
                    checked={preferences.channels.includes(channel.id) && !unavailable}
                    disabled={unavailable}
                    onChange={(event) => setPreferences((current) => ({
                      ...current,
                      channels: event.target.checked
                        ? [...current.channels, channel.id]
                        : current.channels.filter((entry) => entry !== channel.id),
                    }))}
                    className="h-4 w-4 accent-primary"
                  />
                  {channel.label}
                </label>
                {unavailable && (
                  <p className="pl-6 text-xs text-muted-foreground">
                    Webex isn&apos;t connected yet.{" "}
                    <Link
                      href="/credentials#connections"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-4 hover:no-underline"
                    >
                      Connect Webex
                    </Link>{" "}
                    to enable this option.
                  </p>
                )}
              </div>
            );
          })}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">When would you like to be notified?</h3>
          <Select
            aria-label="When would you like to be notified?"
            className="w-56"
            value={preferences.cadence}
            onChange={(event) => setPreferences((current) => ({
              ...current,
              cadence: event.target.value as Cadence,
            }))}
          >
            {CADENCES.map((cadence) => (
              <option key={cadence.id} value={cadence.id}>{cadence.label}</option>
            ))}
          </Select>

          <div className="flex items-center gap-3 pt-1">
            <Switch
              checked={quiet.enabled}
              onCheckedChange={(next) => setPreferences((current) => ({
                ...current,
                quietHours: { ...current.quietHours, enabled: next },
              }))}
              aria-label="Quiet hours"
            />
            <span className="text-sm font-medium">Quiet hours</span>
          </div>

          {quiet.enabled && (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="tome-quiet-from" className="text-sm text-muted-foreground">From</Label>
              <Select
                id="tome-quiet-from"
                className="w-28"
                value={String(quiet.from)}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  quietHours: { ...current.quietHours, from: Number(event.target.value) },
                }))}
              >
                {HOURS.map((hour) => (
                  <option key={hour.value} value={hour.value}>{hour.label}</option>
                ))}
              </Select>

              <Label htmlFor="tome-quiet-to" className="text-sm text-muted-foreground">To</Label>
              <Select
                id="tome-quiet-to"
                className="w-28"
                value={String(quiet.to)}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  quietHours: { ...current.quietHours, to: Number(event.target.value) },
                }))}
              >
                {HOURS.map((hour) => (
                  <option key={hour.value} value={hour.value}>{hour.label}</option>
                ))}
              </Select>

              <Select
                aria-label="Quiet hours time zone"
                className="w-48"
                value={quiet.timezone}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  quietHours: { ...current.quietHours, timezone: event.target.value },
                }))}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </Select>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Followed spaces</h3>
            <RowControls
              value={{
                level: preferences.level,
                channels: preferences.channels,
                cadence: preferences.cadence,
              }}
              mixed={{
                level: sharedValue(everySpace.map((entry) => entry.level)) === null,
                channels: sharedValue(everySpace.map((entry) => channelsLabel(entry.channels))) === null,
                cadence: sharedValue(everySpace.map((entry) => entry.cadence)) === null,
              }}
              disabled={allSlugs.length === 0}
              labelSuffix="every space"
              onChange={(next) => setSpaces(allSlugs, next)}
            />
          </div>

          {loadError && <p className="text-sm text-muted-foreground">{loadError}</p>}

          <div className="rounded-lg border bg-card">
            <div className="flex items-center gap-2 border-b py-2 pl-2 pr-2">
              <span aria-hidden className="w-3.5 shrink-0" />
              <SelectionCheckbox
                checked={allFollowed}
                indeterminate={followed.size > 0 && !allFollowed}
                onCheckedChange={(next) => setFollowing(allSlugs, next)}
                label="Follow everything"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">Select all</span>
            </div>

            {nodes === null ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading your spaces…</p>
            ) : roots.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No BHAGs, areas or projects are shared with you yet.
              </p>
            ) : (
              <ul className="py-1">
                {roots.map((root) => (
                  <SpaceRow
                    key={root.node.slug}
                    item={root}
                    followed={followed}
                    preferences={preferences}
                    onFollowChange={setFollowing}
                    onSpaceChange={setSpaces}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between gap-4 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          A preview. Nothing here is saved yet, and what reaches you is unchanged
          meanwhile — the choices above are for agreeing on, not yet for keeping.
        </p>
        <Button disabled>Save</Button>
      </div>
    </div>
  );
}
