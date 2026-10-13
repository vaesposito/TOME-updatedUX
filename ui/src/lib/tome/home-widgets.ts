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

export type TomeHomeWidgetId =
  | "ask"
  | "attention"
  | "tagged"
  | "updates"
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
}

/**
 * Every card, in the order a project's home page ships in.
 *
 * This order is also where a card lands for a reader who has arranged their
 * page without it, so a new card belongs next to the one it is about rather
 * than at the end of the list.
 */
export const TOME_HOME_WIDGETS: readonly TomeHomeWidget[] = [
  { id: "ask", label: "Ask the agent", width: 3 },
  { id: "attention", label: "Needs attention", width: 2 },
  { id: "tagged", label: "Tagged for you", width: 1 },
  { id: "updates", label: "Latest updates", width: 3 },
  { id: "glance", label: "At a glance", width: 2 },
  { id: "milestones", label: "Milestones", width: 1 },
  { id: "team", label: "Team", width: 1 },
  { id: "sources", label: "Sources", width: 1 },
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

/** The cards to render, in the order to render them. */
export function visibleWidgets(layout: TomeHomeLayout): TomeHomeWidgetId[] {
  const hidden = new Set(clean(layout.hidden));
  const shown = clean(layout.order).filter((id) => !hidden.has(id));
  for (const id of DEFAULT_ORDER) {
    if (hidden.has(id) || shown.includes(id)) continue;
    shown.splice(insertionIndex(id, shown, DEFAULT_ORDER), 0, id);
  }
  return shown;
}

/**
 * Record a new order for the cards on show.
 *
 * The cards behind the eye are not in the dragged list, so they are threaded
 * back in beside whoever they used to follow. Without that they would all
 * collect at the front of the order and reappear in the wrong place.
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
