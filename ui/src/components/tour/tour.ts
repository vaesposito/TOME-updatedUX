/**
 * What every walkthrough is made of.
 *
 * A tour is a list of steps, each naming a control that is really on the
 * screen, and the runner in TourRunner.tsx walks them. Two tours are built
 * on this: the notifications one, and the tour of TOME's features.
 */

/** Where a step can be anchored. Elements carry `data-tour="<id>"`. */
export type TourAnchor =
  | "notifications-bell"
  | "notifications-inbox"
  | "notifications-watching"
  | "notifications-watching-tree"
  | "watch-toggle"
  | "page-notify"
  | "page-edit"
  | "project-home"
  | "hub-tabs"
  | "hub-search"
  | "hub-create"
  | "hub-mcp";

/**
 * What a tour had to look up before it could run.
 *
 * Steps about a project depend on the reader: a tour borrows the first one
 * they can actually read rather than shipping a slug that only exists in one
 * deployment.
 */
export interface TourSubject {
  /** A project the reader can read, or null if they can read none. */
  slug: string | null;
  /** A page in that project, for steps about one. */
  pagePath: string | null;
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** The element this step is about. */
  anchor: TourAnchor;
  /**
   * Anchored here instead while `anchor` is absent, with `hint` for the body.
   *
   * For steps whose subject only exists in a particular state — the save-time
   * notification menu appears once a page is being edited — so the step can
   * point at the way in rather than at nothing.
   */
  waitingAnchor?: TourAnchor;
  /** What to do to bring `anchor` into existence. */
  hint?: string;
  /** Where the anchor lives, or null when it is on every page. */
  route?: (subject: TourSubject) => string | null;
  /** Shown when `route` comes back empty, naming what is missing. */
  unavailable?: string;
}

/**
 * Where the tours keep their place.
 *
 * In `sessionStorage` because a tour walks between routes, and a full page
 * load must not drop the reader back at step one. Per tab, and gone when the
 * tab is — an unfinished tour is not something to be reminded of next week.
 *
 * One key each, so finishing one tour does not resume the other.
 */
export const TOUR_STATE_KEYS = {
  notifications: "grid.tour.notifications",
  features: "grid.tour.features",
} as const;

/**
 * Whether any walkthrough is part-way through.
 *
 * For anything that opens itself on arrival to check before it does. A tour
 * navigates into projects and pages, and a first-run dialog that greeted it
 * there would cover the step the reader is in the middle of.
 */
export function isTourRunning(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Object.values(TOUR_STATE_KEYS).some(
      (key) => window.sessionStorage.getItem(key) !== null,
    );
  } catch {
    return false;
  }
}

/**
 * Whether two paths name the same page.
 *
 * Compared decoded, because a wiki path is pushed encoded but read back from
 * the router in whichever form the browser settled on. Comparing the raw
 * strings would leave the two disagreeing forever, and the step would push
 * its own route on every render.
 */
export function samePath(a: string, b: string): boolean {
  const decoded = (path: string) => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  };
  return decoded(a) === decoded(b);
}
