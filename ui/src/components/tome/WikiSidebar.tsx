"use client";

import { useState, type DragEvent } from "react";
import {
  ChevronRight,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { NavCount } from "@/components/tome/RailNav";
import { cn } from "@/lib/utils";
import { UnreadDot } from "@/components/notifications/UnreadDot";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { KindBadge } from "@/components/tome/KindBadge";
import type { PageKind, PageTreeNode } from "@/types/tome";

interface Props {
  tree: PageTreeNode[];
  selectedPath: string | null;
  selectedFolderId?: string | null;
  onSelect: (path: string) => void;
  onSelectFolder?: (folderId: string) => void;
  showHidden: boolean;
  /** Delete a page (hover-trash on rows). Omitted in read-only contexts. */
  onDelete?: (path: string) => void;
  onCreateFolder?: (parentId: string | null) => void;
  onCreatePage?: (folder: PageTreeNode) => void;
  onEditFolder?: (node: PageTreeNode) => void;
  onDeleteFolder?: (folderId: string) => void;
  onMoveItem?: (item: WikiNavigationItem, target: WikiNavigationTarget) => void;
  /**
   * Pages with activity the reader has not opened, by path.
   *
   * Dotted in place so that catching up does not require going to the inbox
   * first: the tree is where someone already is when they wonder what moved.
   */
  unreadPaths?: ReadonlySet<string>;
  /**
   * Pages and folders ticked for an action that will apply to all of them.
   *
   * Both props or neither: the checkbox column only exists where there is
   * somewhere for a tick to go, which is how the rail stays a list of places
   * to visit while the same tree in settings becomes a thing to tidy.
   */
  checkedPaths?: ReadonlySet<string>;
  onCheckedChange?: (path: string, checked: boolean) => void;
  /**
   * Whether rows carry the right-hand column that reports on them — a page's
   * kind, a folder's size.
   *
   * Off where the tree is a list of places to go. A page's kind is chosen on
   * the page itself, so a badge here only reports a setting, and neither it
   * nor a tally of what is inside a folder helps anyone decide where to go;
   * together they turn every row into a small status display nobody asked to
   * read. On where pages are being surveyed rather than visited, which is
   * what Settings > Content is for.
   */
  showMeta?: boolean;
}

/**
 * Whether anything beneath this node is unread.
 *
 * Only asked of a closed folder, so that a collapsed branch still admits it
 * is hiding something new rather than looking settled.
 */
function hasUnreadBelow(
  node: PageTreeNode,
  unreadPaths: ReadonlySet<string>,
): boolean {
  return node.children.some(
    (child) =>
      (child.kind !== "folder" && unreadPaths.has(child.path)) ||
      hasUnreadBelow(child, unreadPaths),
  );
}

export type WikiNavigationItem = { kind: "page" | "folder"; id: string };
export type WikiNavigationTarget =
  | { position: "root" }
  | { position: "inside" | "before" | "after"; item: WikiNavigationItem };

/** Recursive sidebar nav for the wiki page tree. */
export function WikiSidebar(props: Props) {
  const [dragging, setDragging] = useState(false);
  return (
    <nav className="text-sm">
      <NodeList
        {...props}
        nodes={props.tree}
        depth={0}
        onDraggingChange={setDragging}
      />
      {props.onMoveItem && dragging && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const item = draggedItem(event);
            if (item) props.onMoveItem?.(item, { position: "root" });
            setDragging(false);
          }}
          className="mx-2 mt-2 rounded border border-dashed border-primary/50 bg-primary/5 px-2 py-2 text-center text-[10px] font-medium text-primary"
        >
          Drop here to move to wiki root
        </div>
      )}
    </nav>
  );
}

// Left padding per nesting level.
//
// A folder spends the first sixteen of these on its own mark, because the
// mark begins where a sibling page's title begins rather than hanging to the
// left of it. So a step of sixteen put a child exactly under its parent's
// title and the nesting read as nothing at all; the step has to cover the
// mark and then show a step beyond it. Thirty-two leaves every child clear of
// its parent's title by a full sixteen, which a glance down the rail reads
// without counting.
const STEP_PX = 32;
const BASE_PX = 8;

// Root source folders get their provider's brand mark instead of a bare label.
const ROOT_PROVIDER: Record<string, string> = {
  repos: "github",
  confluence: "atlassian",
  webex: "webex",
  sharepoint: "sharepoint",
};

function NodeList({
  nodes,
  depth,
  selectedPath,
  selectedFolderId,
  onSelect,
  onSelectFolder,
  showHidden,
  onDelete,
  onCreateFolder,
  onCreatePage,
  onEditFolder,
  onDeleteFolder,
  onMoveItem,
  unreadPaths,
  checkedPaths,
  onCheckedChange,
  showMeta,
  onDraggingChange,
}: {
  nodes: PageTreeNode[];
  depth: number;
  onDraggingChange: (dragging: boolean) => void;
} & Omit<Props, "tree">) {
  return (
    <ul>
      {nodes
        .filter((n) => showHidden || n.kind !== "hidden")
        .map((node) => (
          <li key={node.path}>
            <TreeNode
              node={node}
              depth={depth}
              selectedPath={selectedPath}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
              onSelectFolder={onSelectFolder}
              showHidden={showHidden}
              onDelete={onDelete}
              onCreateFolder={onCreateFolder}
              onCreatePage={onCreatePage}
              onEditFolder={onEditFolder}
              onDeleteFolder={onDeleteFolder}
              onMoveItem={onMoveItem}
              unreadPaths={unreadPaths}
              checkedPaths={checkedPaths}
              onCheckedChange={onCheckedChange}
              showMeta={showMeta}
              onDraggingChange={onDraggingChange}
            />
          </li>
        ))}
    </ul>
  );
}

/** A single tree node: a collapsible folder header, or a selectable page row. */
function TreeNode({
  node,
  depth,
  selectedPath,
  selectedFolderId,
  onSelect,
  onSelectFolder,
  showHidden,
  onDelete,
  onCreateFolder,
  onCreatePage,
  onEditFolder,
  onDeleteFolder,
  onMoveItem,
  unreadPaths,
  checkedPaths,
  onCheckedChange,
  showMeta,
  onDraggingChange,
}: {
  node: PageTreeNode;
  depth: number;
  onDraggingChange: (dragging: boolean) => void;
} & Omit<Props, "tree">) {
  const hasChildren = node.children.length > 0;
  const leaf = node.path.split("/").pop() ?? node.path;
  // Holds whatever page is open, however deep. Folders start closed, so
  // without this the rail would hide the reader's own position: they would
  // arrive on a nested page and see a tree that admits nothing is selected.
  const holdsSelection = Boolean(selectedPath?.startsWith(`${node.path}/`));
  const [open, setOpen] = useState(holdsSelection);

  // Opens, and only opens, as the selection moves into this branch: a reader
  // following a link into a folded one is shown where they landed, and can
  // still fold it again afterwards, which deriving `open` outright would not
  // allow. Adjusted during the render that notices the move rather than in an
  // effect, so the rail never paints a frame denying where the reader is.
  const [heldBefore, setHeldBefore] = useState(holdsSelection);
  if (holdsSelection !== heldBefore) {
    setHeldBefore(holdsSelection);
    if (holdsSelection) setOpen(true);
  }
  const [dropZone, setDropZone] = useState<"before" | "inside" | "after" | null>(null);
  const indent = { paddingLeft: `${depth * STEP_PX + BASE_PX}px` };
  const navigationItem: WikiNavigationItem | null = node.kind === "folder"
    ? node.folderId ? { kind: "folder", id: node.folderId } : null
    : { kind: "page", id: node.path };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!navigationItem || !onMoveItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    setDropZone(
      node.kind === "folder"
        ? ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside"
        : ratio < 0.5 ? "before" : "after",
    );
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const item = draggedItem(event);
    if (item && navigationItem && dropZone) {
      onMoveItem?.(item, { position: dropZone, item: navigationItem });
    }
    setDropZone(null);
    onDraggingChange(false);
  };

  const children = hasChildren && (
    <NodeList
      nodes={node.children}
      depth={depth + 1}
      selectedPath={selectedPath}
      selectedFolderId={selectedFolderId}
      onSelect={onSelect}
      onSelectFolder={onSelectFolder}
      showHidden={showHidden}
      onDelete={onDelete}
      onCreateFolder={onCreateFolder}
      onCreatePage={onCreatePage}
      onEditFolder={onEditFolder}
      onDeleteFolder={onDeleteFolder}
      onMoveItem={onMoveItem}
      unreadPaths={unreadPaths}
      checkedPaths={checkedPaths}
      onCheckedChange={onCheckedChange}
      showMeta={showMeta}
      onDraggingChange={onDraggingChange}
    />
  );

  /**
   * The tick, where there is anything to tick for.
   *
   * Stops the click from reaching the row: ticking a page is saying what to
   * do something to, not asking to read it, and opening the page underneath
   * would lose whichever list was being built.
   */
  const checkbox = onCheckedChange ? (
    <input
      type="checkbox"
      checked={checkedPaths?.has(node.path) ?? false}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onCheckedChange(node.path, event.target.checked)}
      aria-label={`Select ${node.title}`}
      className="h-3.5 w-3.5 shrink-0 accent-primary"
    />
  ) : null;

  // Folder = a collapsible section header (the caret toggles its children).
  if (node.kind === "folder") {
    const provider = depth === 0 ? ROOT_PROVIDER[leaf] : undefined;
    const selected = node.folderId === selectedFolderId;
    return (
      <>
        <div
          style={indent}
          onDragOver={handleDragOver}
          onDragLeave={() => setDropZone(null)}
          onDrop={handleDrop}
          className={cn(
            // Set apart from the pages rather than listed among them: a gap
            // above, so a folder reads as the start of what follows it, and
            // a heavier label. The size and the case are the pages' own, so
            // a branch reads as one list at one measure; the folder mark and
            // the space above it are what tell a folder from a page.
            //
            // Indented like a page, not outdented past one: the folder mark
            // begins where a sibling page's title begins, rather than hanging
            // to the left of it in a gutter the pages leave blank. That puts
            // the folder's own title one step in, which is where the pages
            // inside it sit — so a branch reads as a title with its contents
            // ranged under it.
            "group mt-2 flex w-full items-center gap-1 rounded pr-1 py-1 font-semibold text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground",
            selected && "bg-muted text-primary",
            dropZone === "inside" && "bg-primary/15 text-primary ring-1 ring-inset ring-primary/50",
            dropZone === "before" && "border-t-2 border-primary",
            dropZone === "after" && "border-b-2 border-primary",
          )}
        >
          {checkbox}
          <button
            type="button"
            // Both things, as on the rail's own sections: a folder row opens
            // the folder and goes to its page, so the whole row does what the
            // whole row looks like it does and the caret is the way to open
            // one without leaving where you are.
            onClick={() => {
              if (node.folderId && onSelectFolder) onSelectFolder(node.folderId);
              if (hasChildren) setOpen((openState) => !openState);
            }}
            aria-expanded={hasChildren ? open : undefined}
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
          >
            {/* A folder mark unless the folder belongs to a source, in which
                case that source's mark says more. */}
            {provider ? (
              <ProviderLogo provider={provider} className="h-3 w-3 shrink-0 object-contain" />
            ) : open ? (
              <FolderOpen className="h-3 w-3 shrink-0" />
            ) : (
              <Folder className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{node.title}</span>
            {/* Only while closed: open, the dots on the pages themselves say
                it, and saying it twice would make a branch look busier than
                it is. */}
            {!open && unreadPaths && hasUnreadBelow(node, unreadPaths) && (
              // The label does not name the folder: it is inside the folder's
              // own button, so a screen reader already said which one.
              <UnreadDot unread label="New activity" />
            )}
          </button>
          {node.folderId && (onCreatePage || onEditFolder || onMoveItem) && (
            <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
              {onMoveItem && navigationItem && (
                <DragHandle
                  item={navigationItem}
                  label={`Move ${node.title}`}
                  onDraggingChange={onDraggingChange}
                />
              )}
              {onCreateFolder && (
                <FolderAction label={`New folder in ${node.title}`} onClick={() => onCreateFolder(node.folderId!)}>
                  <FolderPlus className="h-3 w-3" />
                </FolderAction>
              )}
              {onCreatePage && (
                <FolderAction label={`New page in ${node.title}`} onClick={() => onCreatePage(node)}>
                  <FilePlus2 className="h-3 w-3" />
                </FolderAction>
              )}
              {onEditFolder && (
                <FolderAction label={`Edit ${node.title}`} onClick={() => onEditFolder(node)}>
                  <Pencil className="h-3 w-3" />
                </FolderAction>
              )}
              {onDeleteFolder && (
                <FolderAction label={`Delete ${node.title}`} onClick={() => onDeleteFolder(node.folderId!)} destructive>
                  <Trash2 className="h-3 w-3" />
                </FolderAction>
              )}
            </span>
          )}
          {/* Last, so the hover actions appearing to its left do not move it,
              and so every row in the rail is toggled from the same edge. A
              folder with nothing in it says so instead: a caret there would
              cost a click to learn what the row could have shown. */}
          {/* Out of the way while the row is hovered, where the move and edit
              actions want the same space. */}
          <NavCount count={node.children.length} className="ml-auto group-hover:hidden" />
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${node.title}`}
              className="shrink-0"
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 shrink-0 transition-transform",
                  open && "rotate-90",
                )}
              />
            </button>
          ) : (
            <span className="h-3 w-3 shrink-0" aria-hidden />
          )}
        </div>
        {open && children}
      </>
    );
  }

  const selected = node.path === selectedPath;
  const unread = unreadPaths?.has(node.path) ?? false;
  return (
    <>
      {/* `group` row: title button, then the (always-visible) kind badge, then
          the hover-trash. Badge + trash are siblings of the button (a button
          can't nest a button); the trash keeps its layout slot via opacity so
          the badge sits at a stable position whether or not it shows. */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={() => setDropZone(null)}
        onDrop={handleDrop}
        className={cn(
          "group flex items-center gap-1.5 rounded pr-1.5 transition-colors hover:bg-muted",
          selected && "bg-muted font-medium text-primary",
          dropZone === "before" && "border-t-2 border-primary",
          dropZone === "after" && "border-b-2 border-primary",
        )}
      >
        {checkbox && <span style={indent} className="flex shrink-0 pl-1">{checkbox}</span>}
        <button
          type="button"
          style={checkbox ? undefined : indent}
          onClick={() => onSelect(node.path)}
          className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left"
        >
          <span className={cn("truncate", unread && "font-medium text-foreground")}>
            {node.title}
          </span>
          {/* Next to the title rather than at the row's end: the dot is about
              this page's content, not about what sort of page it is. */}
          <UnreadDot unread={unread} label="New activity" />
        </button>
        {showMeta && (
          <span className="flex shrink-0 items-center">
            <KindBadge kind={node.kind as PageKind} iconOnly />
          </span>
        )}
        {onMoveItem && navigationItem && (
          <span className="hidden group-hover:inline-flex">
            <DragHandle
              item={navigationItem}
              label={`Move ${node.title}`}
              onDraggingChange={onDraggingChange}
            />
          </span>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.path);
            }}
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            aria-label={`Delete ${node.title}`}
            title={`Delete ${node.title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Where a folder's caret would be, so the rows end together. */}
        <span className="h-3 w-3 shrink-0" aria-hidden />
      </div>
      {children}
    </>
  );
}

const DRAG_MIME = "application/x-tome-navigation-item";

function draggedItem(event: DragEvent<HTMLElement>): WikiNavigationItem | null {
  try {
    const encoded = event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData("text/plain");
    const value = JSON.parse(encoded) as WikiNavigationItem;
    return (value.kind === "page" || value.kind === "folder") && typeof value.id === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

function DragHandle({
  item,
  label,
  onDraggingChange,
}: {
  item: WikiNavigationItem;
  label: string;
  onDraggingChange: (dragging: boolean) => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        const encoded = JSON.stringify(item);
        event.dataTransfer.setData(DRAG_MIME, encoded);
        event.dataTransfer.setData("text/plain", encoded);
        onDraggingChange(true);
      }}
      onDragEnd={() => onDraggingChange(false)}
      className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground active:cursor-grabbing"
      aria-label={label}
      title={`${label} — drag to reorder or move`}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
}

function FolderAction({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground",
        destructive && "hover:text-destructive",
      )}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
