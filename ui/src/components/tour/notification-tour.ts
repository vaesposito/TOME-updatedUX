/**
 * The notifications walkthrough: five places, in the order someone meets them.
 *
 * A tour of real controls rather than a slideshow of pictures. Each step
 * points at the element it describes, wherever that element lives — which
 * means the tour navigates between settings and a project, and that the
 * reader can click the thing being explained while it is explained.
 *
 * The order runs outwards: first where notifications arrive (the bell), then
 * where they are chosen (settings, and a project's own Follow button), then
 * where they are created (saving a page), and finally where they are read in
 * bulk (a project's Home). Reading it through should answer both "where do I
 * see these" and "why am I getting them".
 */

import { NOTIFICATION_SETTINGS_HREF } from "@/components/settings/settings-routes";
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
      "It counts what you have not read yet, and holds them grouped by where they came from. Reading one takes you to the thing it happened to, and Mark all read clears the count.",
  },
  {
    id: "following",
    anchor: "notifications-following",
    route: () => NOTIFICATION_SETTINGS_HREF,
    title: "Settings decides what you are sent",
    body:
      "Tick a BHAG, an area or a project and its changes reach you. Each row also says what kind of change is worth telling you about, where it should reach you, and how often — and the controls above the list set all of them at once.",
  },
  {
    id: "watch",
    anchor: "watch-toggle",
    route: (subject) =>
      subject.slug ? `/projects/${subject.slug}/tome` : null,
    title: "Or follow a project from the project",
    body:
      "The same choice as the one in settings, made on the thing it concerns. The count beside it is how many other people are following, so you can tell whether a change will be noticed.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
  {
    id: "notify",
    anchor: "page-notify",
    waitingAnchor: "page-edit",
    // The page is opened for editing and the menu with it. Leaving the step
    // presses Cancel, which discards the draft the editor writes half a
    // second after it opens, so a page is never left changed by being
    // walked past. See the same step in the editing tour.
    opens: ["page-edit", "page-notify"],
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
