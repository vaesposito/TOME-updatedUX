/**
 * What every walkthrough is made of.
 *
 * A tour is a list of steps, each naming a control that is really on the
 * screen, and the runner in TourRunner.tsx walks them. The tours themselves
 * are listed in tour-catalog.ts: a reader chooses the one they want rather
 * than being given the only one we wrote.
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
  | "hub-mcp"
  | "hub-tab-functions"
  | "hub-tab-overview"
  | "hub-tab-digest"
  | "editor-mode"
  | "custom-prompts"
  | "page-tags"
  | "ask-tome"
  | "home-ask"
  | "webex-settings";

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
  /**
   * The element this step is about.
   *
   * Left out for a step that explains an idea rather than a control — what
   * an edge is, say. Those are shown in the middle of the window straight
   * away, rather than after the wait a missing anchor is given.
   */
  anchor?: TourAnchor;
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
  /**
   * Controls the runner presses on arrival, in the order given.
   *
   * A step whose subject is a panel behind a button — the bell's list, the
   * Notifications menu, the agent — used to ring the closed button and ask
   * the reader to open it. It opens it for them, so what the step describes
   * is on the screen while they read about it. The last one is usually the
   * step's own `anchor`, since what is being explained is what it opens.
   *
   * Only name a control the runner can undo: it puts each of these back when
   * the step is left, by pressing the button again or by choosing the tab
   * that was chosen before, so a tour must not be able to change the
   * reader's pages by being walked. That rules out Edit, which has no way
   * back the runner can reach — steps behind it keep `waitingAnchor` and
   * `hint` and wait for the reader.
   */
  opens?: readonly TourAnchor[];
  /**
   * Where the anchor lives, or null when it is on every page.
   *
   * A query string counts: the catalogue's four readings are one path with
   * different tabs, so a step about the Digest asks for `?tab=digest`.
   */
  route?: (subject: TourSubject) => string | null;
  /** Shown when `route` comes back empty, naming what is missing. */
  unavailable?: string;
}

/** A walkthrough, as the chooser lists it. */
export interface Tour {
  id: string;
  /** What the chooser calls it. */
  name: string;
  /** One line on what it covers, so the choice can be made without taking it. */
  blurb: string;
  steps: readonly TourStep[];
}

/**
 * Where a tour keeps its place.
 *
 * In `sessionStorage` because a tour walks between routes, and a full page
 * load must not drop the reader back at step one. Per tab, and gone when the
 * tab is — an unfinished tour is not something to be reminded of next week.
 *
 * One key for all of them, holding which tour it belongs to: only one tour
 * can be running, and a key each meant a half-finished one waking up weeks
 * later in a tab that had never been closed.
 */
export const TOUR_STATE_KEY = "grid.tour";

/** Dispatched on `window` to start a tour. `detail.id` names which one. */
export const TOUR_START_EVENT = "grid.tour:start";

/** Ask for a tour by id, from anywhere in the app. */
export function startTour(id: string): void {
  window.dispatchEvent(new CustomEvent(TOUR_START_EVENT, { detail: { id } }));
}

/** Which tour a start event asked for, or null if it did not say. */
export function requestedTourId(event: Event): string | null {
  const detail = (event as CustomEvent<{ id?: unknown }>).detail;
  return typeof detail?.id === "string" ? detail.id : null;
}

/**
 * Whether a walkthrough is part-way through.
 *
 * For anything that opens itself on arrival to check before it does. A tour
 * navigates into projects and pages, and a first-run dialog that greeted it
 * there would cover the step the reader is in the middle of.
 */
export function isTourRunning(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(TOUR_STATE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * The project a path is inside, or null if it is not inside one.
 *
 * So a tour started from a project is about that project, rather than about
 * whichever one it would have borrowed from a reader standing on the
 * catalogue.
 */
export function projectSlugFromPath(path: string | null | undefined): string | null {
  const slug = /^\/projects\/([^/?#]+)/.exec(path ?? "")?.[1];
  // `/projects/admin` is TOME's own settings page, not a project.
  if (!slug || slug === "admin") return null;
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/**
 * Whether two locations name the same place, path and query alike.
 *
 * Compared decoded, because a wiki path is pushed encoded but read back from
 * the router in whichever form the browser settled on. Comparing the raw
 * strings would leave the two disagreeing forever, and the step would push
 * its own route on every render.
 *
 * The query counts: the catalogue's tabs live in one, and a step asking for
 * `?tab=digest` while standing on a bare `/projects` has not arrived yet.
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
