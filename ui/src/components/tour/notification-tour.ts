/**
 * The notifications walkthrough: six places, in the order someone meets them.
 *
 * A tour of real controls rather than a slideshow of pictures. Each step
 * points at the element it describes, wherever that element lives — which
 * means the tour navigates between the notification page and a project, and
 * that the reader can click the thing being explained while it is explained.
 *
 * The order runs outwards: first where notifications arrive (the bell, the
 * inbox), then where they are chosen (Following, a project's own Follow
 * button), then where they are created (saving a page), and finally where
 * they are read in bulk (a project's Home). Reading it through should
 * answer both "where do I see these" and "why am I getting them".
 */

import type { TourStep } from "@/components/tour/tour";

// Re-exported because this file was the whole of the tour before there were
// five of them, and its callers have no reason to care that the shape moved.
export {
  isTourRunning,
  samePath,
  type TourAnchor,
  type TourStep,
  type TourSubject,
} from "@/components/tour/tour";

export const NOTIFICATION_TOUR: readonly TourStep[] = [
  {
    id: "bell",
    anchor: "notifications-bell",
    opens: ["notifications-bell"],
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
    // The tree is the subject and only exists once the tab is open, so the
    // step opens it. The hint is what is left if the tab cannot be pressed.
    anchor: "notifications-watching-tree",
    waitingAnchor: "notifications-watching",
    opens: ["notifications-watching"],
    hint: "Open Following to choose what reaches you.",
    route: () => "/notifications",
    title: "Following decides what you are sent",
    body:
      "Tick a BHAG, an area or a project and its changes reach you. Each followed row also carries a Webex button, for sending that project's updates on to a team space or to your own direct messages.",
  },
  {
    id: "watch",
    anchor: "watch-toggle",
    route: (subject) =>
      subject.slug ? `/projects/${subject.slug}/tome` : null,
    title: "Or follow a project from the project",
    body:
      "The same choice as the Following tab, made on the thing it concerns. The count beside it is how many other people are following, so you can tell whether a change will be noticed.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
  {
    id: "notify",
    anchor: "page-notify",
    waitingAnchor: "page-edit",
    // Edit is the reader's to press — there is no way out of it the runner
    // can reach, and a tour must not leave a page half-edited. The menu it
    // reveals is opened for them as soon as it appears.
    opens: ["page-notify"],
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
    anchor: "project-home",
    route: (subject) =>
      subject.slug ? `/projects/${subject.slug}/tome` : null,
    title: "A project's Home gathers them",
    body:
      "Home divides the same notifications into what is waiting on someone, what named you, and what simply happened — alongside who works here, what was committed to, and where the knowledge comes from.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
];

// The event and the saved place belong to every tour, not to this one.
export { TOUR_START_EVENT, TOUR_STATE_KEY } from "@/components/tour/tour";
