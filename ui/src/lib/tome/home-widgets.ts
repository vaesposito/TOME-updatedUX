/**
 * Which cards a project's home page shows, and in what order.
 *
 * Stored as the reader's arrangement plus the set they have put away, rather
 * than as the list of what to show. Keeping the two apart is what lets a card
 * added in a later release appear for everyone who has already arranged their
 * page — it is in neither list, so it is new rather than unwanted — and what
 * lets a card come back where it was rather than at the end.
 *
 * One arrangement covers every space. A reader passes through many projects
 * and the cards mean the same thing in each, so arranging them once is the
 * point; a per-project layout would be a setting nobody finished.
 */

import type { ProjectType } from "@/types/projects";

/**
 * What a home page is about.
 *
 * The workspace is not an entity — there is nothing above a BHAG to be one —
 * but the hub's Overview tab reads like a home page for it, so it takes the
 * same place in these functions as the kind of entity being read.
 */
export type HomeScope = ProjectType | "workspace";

export type TomeHomeWidgetId =
  | "about"
  | "ask"
  | "attention"
  | "tagged"
  | "changes"
  | "decisions"
  | "updates"
  | "children"
  | "partof"
  | "glance"
  | "milestones"
  | "team"
  | "sources"
  | "kpis";

export interface TomeHomeWidget {
  id: TomeHomeWidgetId;
  /** Names the card in the controls that move and hide it. */
  label: string;
  /** Columns on a wide window, of three. */
  width: 1 | 2 | 3;
  /**
   * The kinds of entity this card says anything about. Omitted means all of
   * them.
   *
   * A Project has nothing below it, so a card listing what is below would be
   * permanently empty there — and an empty card is worse than an absent one,
   * because it reads as something broken rather than something inapplicable.
   */
  kinds?: readonly ProjectType[];
  /**
   * Whether this card also means something with no single space in view.
   *
   * Opt-in rather than inherited from `kinds`, because most of these cards
   * are about one wiki — its roadmap, a question put to its agent — and have
   * no answer at all when "this space" is every space. The ones that survive
   * the move up are the ones made of rows, and the two that are roll-ups of
   * the spaces below wherever they are read: what the work reads from, and
   * who answers for it.
   */
  workspace?: boolean;
}

/**
 * Every card, in the order a project's home page ships in.
 *
 * This order is also where a card lands for a reader who has arranged their
 * page without it, so a new card belongs next to the one it is about rather
 * than at the end of the list.
 */
export const TOME_HOME_WIDGETS: readonly TomeHomeWidget[] = [
  // First, because it answers "what is this" and every other card assumes a
  // reader who already knows. Whole-width so a description written as prose
  // is read as prose rather than down a column.
  { id: "about", label: "About", width: 3 },
  { id: "ask", label: "Ask the agent", width: 3 },
  { id: "attention", label: "Needs attention", width: 2, workspace: true },
  { id: "tagged", label: "Tagged for you", width: 1, workspace: true },
  // The space's own record and the questions it is still carrying, as one
  // row. Neither has an answer with no single space in view: there is no
  // workspace-wide feed, and decisions roll up from a space, not from all of
  // them.
  { id: "changes", label: "Changed this week", width: 2 },
  { id: "decisions", label: "Open decisions", width: 1 },
  { id: "updates", label: "Latest updates", width: 3, workspace: true },
  {
    id: "children",
    label: "Areas & projects",
    width: 3,
    kinds: ["bhag", "area"],
    workspace: true,
  },
  // Beside the card for what is below, because the two are one question read
  // in opposite directions. Left out at the top of the tree: there is nothing
  // above a BHAG, and a permanently empty card reads as something broken
  // rather than something inapplicable.
  //
  // Whole-width, as every card that only some kinds of space get has to be:
  // the page is three columns and the shipped set fills whole rows of them,
  // so a card present for two kinds and absent for the third can only leave
  // that true if it is a row of its own. It reads across anyway — a trail is
  // a path, not a list.
  { id: "partof", label: "Part of", width: 3, kinds: ["project", "area"] },
  { id: "glance", label: "At a glance", width: 2 },
  { id: "milestones", label: "Milestones", width: 1 },
  { id: "team", label: "Team", width: 1, workspace: true },
  { id: "sources", label: "Sources", width: 1, workspace: true },
  { id: "kpis", label: "KPIs", width: 1 },
];

const DEFAULT_ORDER: readonly TomeHomeWidgetId[] = TOME_HOME_WIDGETS.map(
  (widget) => widget.id,
);

const KNOWN = new Set<string>(DEFAULT_ORDER);

export interface TomeHomeLayout {
  /** The reader's own order. Empty until they move something. */
  order: readonly TomeHomeWidgetId[];
  /** Put away on purpose, which is why it is kept apart from the order. */
  hidden: readonly TomeHomeWidgetId[];
}

export const DEFAULT_TOME_HOME_LAYOUT: TomeHomeLayout = {
  order: [],
  hidden: [],
};

export function widgetLabel(id: TomeHomeWidgetId): string {
  return TOME_HOME_WIDGETS.find((widget) => widget.id === id)?.label ?? id;
}

/** Whether this card means anything at this altitude. */
export function widgetAppliesTo(
  id: TomeHomeWidgetId,
  scope: HomeScope,
): boolean {
  const widget = TOME_HOME_WIDGETS.find((entry) => entry.id === id);
  if (!widget) return true;
  if (scope === "workspace") return Boolean(widget.workspace);
  return !widget.kinds || widget.kinds.includes(scope);
}

/** Tailwind's share of the three columns, on windows wide enough to have them. */
export function widgetWidthClass(width: 1 | 2 | 3): string {
  if (width === 3) return "lg:col-span-3";
  if (width === 2) return "lg:col-span-2";
  return "";
}

/** Whether this is an arrangement at all, or just the page as it ships. */
export function isCustomized(layout: TomeHomeLayout): boolean {
  if (clean(layout.hidden).length > 0) return true;
  const order = clean(layout.order);
  if (order.length === 0) return false;
  return order.some((id, index) => id !== DEFAULT_ORDER[index]);
}

/**
 * Where to put `id` in `into`, judged by the company it keeps in `reference`.
 *
 * After the nearest thing that precedes it in the reference order and is
 * actually present, so a card returning from behind the eye — or arriving in
 * a release — lands beside its neighbour instead of at the end of the page.
 */
function insertionIndex(
  id: TomeHomeWidgetId,
  into: readonly TomeHomeWidgetId[],
  reference: readonly TomeHomeWidgetId[],
): number {
  for (let at = reference.indexOf(id) - 1; at >= 0; at -= 1) {
    const found = into.indexOf(reference[at]);
    if (found !== -1) return found + 1;
  }
  return 0;
}

function clean(ids: readonly unknown[]): TomeHomeWidgetId[] {
  return ids.filter(
    (id, index): id is TomeHomeWidgetId =>
      typeof id === "string" && KNOWN.has(id) && ids.indexOf(id) === index,
  );
}

/**
 * The cards to render, in the order to render them.
 *
 * The scope filters the result rather than the arrangement: an order and a
 * hidden set are the reader's, and they are the same wherever they are, so a
 * card that does not apply to what is being read is left out of the answer
 * without being forgotten.
 */
export function visibleWidgets(
  layout: TomeHomeLayout,
  scope?: HomeScope,
): TomeHomeWidgetId[] {
  const hidden = new Set(clean(layout.hidden));
  const shown = clean(layout.order).filter((id) => !hidden.has(id));
  for (const id of DEFAULT_ORDER) {
    if (hidden.has(id) || shown.includes(id)) continue;
    shown.splice(insertionIndex(id, shown, DEFAULT_ORDER), 0, id);
  }
  return scope ? shown.filter((id) => widgetAppliesTo(id, scope)) : shown;
}

/**
 * Record a new order for the cards on show.
 *
 * Not every card is in the dragged list: one behind the eye is not, and nor
 * is one that says nothing about the kind of space being read — a project's
 * home has no card for what is below it. Those are threaded back in beside
 * whoever they used to follow, so moving a card here cannot quietly forget
 * where the reader put a card they can only see somewhere else.
 *
 * Only the reader's own order is consulted, never the shipped one. A card
 * they have never placed has no place to keep, and reading it out of the
 * shipped order would drag its neighbours along behind it.
 */
export function withOrder(
  layout: TomeHomeLayout,
  shown: readonly TomeHomeWidgetId[],
): TomeHomeLayout {
  const previous = clean(layout.order);
  const order = clean(shown);
  for (const id of previous) {
    if (order.includes(id)) continue;
    order.splice(insertionIndex(id, order, previous), 0, id);
  }
  return { order, hidden: clean(layout.hidden) };
}

export function withHidden(
  layout: TomeHomeLayout,
  id: TomeHomeWidgetId,
): TomeHomeLayout {
  if (layout.hidden.includes(id)) return layout;
  // Left in the order on purpose: it is where this card goes when it comes
  // back, and nothing reads the order of a card it is not showing.
  return {
    order: visibleWidgets(layout),
    hidden: [...clean(layout.hidden), id],
  };
}

export function withShown(
  layout: TomeHomeLayout,
  id: TomeHomeWidgetId,
): TomeHomeLayout {
  return {
    order: clean(layout.order),
    hidden: clean(layout.hidden).filter((hidden) => hidden !== id),
  };
}

/** Read an arrangement out of whatever a browser or a server had stored. */
export function parseLayout(value: unknown): TomeHomeLayout {
  if (!value || typeof value !== "object") return DEFAULT_TOME_HOME_LAYOUT;
  const raw = value as { order?: unknown; hidden?: unknown };
  return {
    order: clean(Array.isArray(raw.order) ? raw.order : []),
    hidden: clean(Array.isArray(raw.hidden) ? raw.hidden : []),
  };
}
