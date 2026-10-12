/**
 * The notifications walkthrough: six places, in the order someone meets them.
 *
 * A tour of real controls rather than a slideshow of pictures. Each step
 * points at the element it describes, wherever that element lives — which
 * means the tour navigates between the notification page and a project, and
 * that the reader can click the thing being explained while it is explained.
 *
 * The order runs outwards: first where notifications arrive (the bell, the
 * inbox), then where they are chosen (Watching, a project's own Watch
 * button), then where they are created (saving a page), and finally where
 * they are read in bulk (a project's What's new). Reading it through should
 * answer both "where do I see these" and "why am I getting them".
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
  | "project-summary";

/**
 * What the tour had to look up before it could run.
 *
 * The last three steps are about a project, and which project that is
 * depends on the reader: the tour borrows the first one they can actually
 * read rather than shipping a slug that only exists in one deployment.
 */
export interface TourSubject {
  /** A project the reader can read, or null if they can read none. */
  slug: string | null;
  /** A page in that project, for the step about saving one. */
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

export const NOTIFICATION_TOUR: readonly TourStep[] = [
  {
    id: "bell",
    anchor: "notifications-bell",
    title: "The bell is where they arrive",
    body:
      "It counts what you have not read yet. Open it for the most recent few, grouped by the project they came from, and to mark the lot as read.",
  },
  {
    id: "inbox",
    anchor: "notifications-inbox",
    route: () => "/notifications",
    title: "The inbox holds all of them",
    body:
      "The bell's See more opens this page: everything you have been sent, not just the latest few. This bar narrows it to what needs attention or what tagged you, and the list can be grouped by date, by source or by what happened.",
  },
  {
    id: "watching",
    // The tree is the subject, and it only exists once the tab is open, so
    // the step points at the tab until the reader opens it.
    anchor: "notifications-watching-tree",
    waitingAnchor: "notifications-watching",
    hint: "Open Watching to choose what reaches you.",
    route: () => "/notifications",
    title: "Watching decides what you are sent",
    body:
      "Tick a BHAG, an area or a project and its changes reach you. Each watched row also carries a Webex button, for sending that project's updates on to a team space or to your own direct messages.",
  },
  {
    id: "watch",
    anchor: "watch-toggle",
    route: (subject) =>
      subject.slug ? `/projects/${subject.slug}/tome` : null,
    title: "Or watch a project from the project",
    body:
      "The same choice as the Watching tab, made on the thing it concerns. The count beside it is how many other people are watching, so you can tell whether a change will be noticed.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
  {
    id: "notify",
    anchor: "page-notify",
    waitingAnchor: "page-edit",
    route: (subject) =>
      subject.slug && subject.pagePath
        ? `/projects/${subject.slug}/tome/wiki/${subject.pagePath
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`
        : null,
    title: "Saying who should hear about an edit",
    body:
      "Beside Save, because it is part of saving. Tell the people watching or keep the edit quiet, mark it as needing attention, and tag anyone who should read it — with a note saying why.",
    hint: "Choose Edit. The Notifications button appears beside Save.",
    unavailable:
      "This step needs a wiki page to open, and there is not one to borrow yet.",
  },
  {
    id: "summary",
    anchor: "project-summary",
    route: (subject) =>
      subject.slug ? `/projects/${subject.slug}/tome` : null,
    title: "What's new reads them all at once",
    body:
      "A project's front page collects the same notifications into one read: what needs attention, what was decided, and what the teams below have shipped. Dismiss from here and it leaves your inbox too.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
];

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

/** Dispatched on `window` to start the tour from anywhere. */
export const TOUR_START_EVENT = "grid.tour:start";

/**
 * Where the tour keeps its place.
 *
 * In `sessionStorage` because the tour walks between routes, and a full page
 * load must not drop the reader back at step one. Per tab, and gone when the
 * tab is — an unfinished tour is not something to be reminded of next week.
 */
export const TOUR_STATE_KEY = "grid.tour.notifications";

/**
 * Whether a walkthrough is part-way through.
 *
 * For anything that opens itself on arrival to check before it does. The
 * tour navigates into projects and pages, and a first-run dialog that
 * greeted it there would cover the step the reader is in the middle of.
 */
export function isTourRunning(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(TOUR_STATE_KEY) !== null;
  } catch {
    return false;
  }
}
