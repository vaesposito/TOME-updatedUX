"use client";

import {
  ChevronRight,
  FileText,
  Layers,
  Target,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { SelectionCheckbox } from "@/components/notifications/SelectionCheckbox";
import {
  useWebexDelivery,
  type WebexDeliveryState,
} from "@/components/notifications/useWebexDelivery";
import { WebexRuleChip } from "@/components/notifications/WebexRuleChip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  NotificationFollowTree as FollowTree,
  NotificationFollowTreeNode,
} from "@/types/in-app-notification";

/**
 * The Watching tab: pick what to watch, and where each watched space's
 * updates are sent on to.
 *
 * Checking a tier checks everything under it, so a whole BHAG can be watched
 * in one click and a single Project can still be picked out of it. The box is
 * therefore about the subtree, not the row: filled when all of it is
 * watched, dashed when only part is.
 *
 * Webex delivery lives on the rows rather than in a tab of its own: the rule
 * is a property of the watch, and keeping the two apart meant finding the
 * same project in two lists to say you wanted to hear about it.
 */

/** Same glyphs the breadcrumb and the notification filters use per tier. */
const TIER_ICON: Partial<Record<NotificationFollowTreeNode["type"], LucideIcon>> = {
  bhag: Target,
  area: Layers,
  page: FileText,
};

// No colour per tier: the glyphs differ and the rows are indented, so the
// hierarchy is already legible without a palette to learn.
const TIER_ICON_CLASS: Partial<Record<NotificationFollowTreeNode["type"], string>> = {
  page: "text-muted-foreground",
};

function TierIcon({ type }: { type: NotificationFollowTreeNode["type"] }) {
  const Icon = TIER_ICON[type];
  if (!Icon) return null;
  return (
    <Icon
      className={cn("h-3.5 w-3.5 shrink-0", TIER_ICON_CLASS[type])}
      aria-hidden="true"
    />
  );
}

interface TreeItem {
  node: NotificationFollowTreeNode;
  depth: number;
  children: TreeItem[];
  /** This node and everything beneath it, for the subtree checkbox. */
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
  // Collect subtree slugs bottom-up; the server's depth-first order means a
  // node's children are already complete when walking the list backwards.
  for (const node of [...nodes].reverse()) {
    const item = items.get(node.slug);
    if (!item) continue;
    item.slugs = [node.slug, ...item.children.flatMap((child) => child.slugs)];
  }
  return roots;
}

function FollowRow({
  item,
  followed,
  expanded,
  onToggleExpanded,
  onFollowChange,
  onMuteChange,
  delivery,
  busy,
}: {
  item: TreeItem;
  followed: ReadonlySet<string>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onFollowChange: (slugs: string[], following: boolean) => void;
  onMuteChange: (slug: string, muted: boolean) => void;
  delivery: WebexDeliveryState;
  busy: boolean;
}) {
  const { node, children, slugs, depth } = item;
  const checkedCount = slugs.filter((slug) => followed.has(slug)).length;
  const all = checkedCount === slugs.length;
  const some = checkedCount > 0 && !all;
  const count = node.subtree_unread;
  const isPage = node.type === "page";

  return (
    <li>
      <div
        className="group flex items-center gap-2 rounded-md py-1.5 pr-2 transition-colors hover:bg-muted/50"
        // Indentation is inline because the depth is data, not a style the
        // tree can know about ahead of time.
        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <SelectionCheckbox
          checked={all}
          indeterminate={some}
          disabled={busy}
          onCheckedChange={(next) => onFollowChange(slugs, next)}
          label={
            children.length > 0
              ? `Watch ${node.title} and everything in it`
              : isPage
                ? `Watch the page ${node.title}`
                : `Watch ${node.title}`
          }
        />

        <TierIcon type={node.type} />

        <span
          className="min-w-0 flex-1 truncate text-sm"
          // A nested page shows only its file name; the full path is the
          // tooltip, since the tree position already says where it lives.
          title={isPage ? node.page_path : undefined}
        >
          {node.title}
        </span>

        {node.muted ? (
          <VolumeX
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-label="Muted"
          />
        ) : null}

        {/* Only on what is actually watched, and never on a page: a rule
            routes an entity's activity somewhere, so there is nothing for it
            to carry until the box beside it is ticked, and pages are watched
            through the entity that owns them. */}
        {node.following && node.type !== "page" ? (
          <WebexRuleChip
            entitySlug={node.entity_slug}
            entityTitle={node.title}
            entityType={node.type}
            delivery={delivery}
            busy={busy}
          />
        ) : null}

        {/* Muting is independent of following — activity can reach you through
            a team as well — so the control stays reachable here, just out of
            the way until the row is under the pointer. Pages have no mute of
            their own: muting is per entity, and the entity's row owns it. */}
        {isPage ? null : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onMuteChange(node.entity_slug, !node.muted)}
            className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          >
            {node.muted ? "Unmute" : "Mute"}
          </Button>
        )}

        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {count > 0 ? count : null}
        </span>
      </div>

      {expanded && children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <ConnectedRow
              key={child.node.slug}
              item={child}
              followed={followed}
              onFollowChange={onFollowChange}
              onMuteChange={onMuteChange}
              delivery={delivery}
              busy={busy}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Holds one node's expanded state, so folding a branch is local to it. */
function ConnectedRow(props: {
  item: TreeItem;
  followed: ReadonlySet<string>;
  onFollowChange: (slugs: string[], following: boolean) => void;
  onMuteChange: (slug: string, muted: boolean) => void;
  delivery: WebexDeliveryState;
  busy: boolean;
}) {
  // Everything open. This tab exists to be read and ticked, and folding the
  // Areas hid every Project behind a click while the page sat mostly empty.
  // Folding is still there for anyone with a tree long enough to want it.
  const [expanded, setExpanded] = React.useState(true);
  return (
    <FollowRow
      {...props}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((open) => !open)}
    />
  );
}

export function NotificationFollowTree({
  tree,
  busy,
  onFollowChange,
  onMuteChange,
}: {
  tree: FollowTree;
  busy: boolean;
  onFollowChange: (slugs: string[], following: boolean) => void;
  onMuteChange: (slug: string, muted: boolean) => void;
}) {
  // Fetched here rather than by the page, so that nobody reading their inbox
  // pays for a settings read they will not use.
  const delivery = useWebexDelivery();
  const roots = React.useMemo(() => buildTree(tree.nodes), [tree.nodes]);
  const followed = React.useMemo(
    () => new Set(tree.nodes.filter((node) => node.following).map((node) => node.slug)),
    [tree.nodes],
  );

  if (tree.nodes.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No BHAGs, areas or projects are shared with you yet.
      </p>
    );
  }

  const allSlugs = tree.nodes.map((node) => node.slug);
  const allFollowed = followed.size === allSlugs.length;

  return (
    <div className="space-y-4">
      <p className="max-w-4xl text-sm text-muted-foreground">
        Choose what you&apos;d like to watch to receive notifications. You can
        change this at any time, or watch and unwatch a space from its own page.
        Anything you watch can also be sent on to Webex — use the button on its
        row to pick a space or a direct message, and how often.
        Individual wiki pages appear here once you watch them from the page
        itself. You will still receive ad-hoc notifications when someone tags
        you on a specific piece of content.
      </p>

      <div className="rounded-lg border bg-card" data-tour="notifications-watching-tree">
        <div className="flex items-center gap-2 border-b py-2 pl-2 pr-2">
          <span className="w-4 shrink-0" />
          <SelectionCheckbox
            checked={allFollowed}
            indeterminate={followed.size > 0 && !allFollowed}
            disabled={busy}
            onCheckedChange={(next) => onFollowChange(allSlugs, next)}
            label="Watch everything"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            Select all
          </span>
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {tree.total_unread > 0 ? tree.total_unread : ""}
          </span>
        </div>

        <ul className="py-1">
          {roots.map((root) => (
            <ConnectedRow
              key={root.node.slug}
              item={root}
              followed={followed}
              onFollowChange={onFollowChange}
              onMuteChange={onMuteChange}
              delivery={delivery}
              busy={busy}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
