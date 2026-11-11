import { AGENT_TOUR } from "@/components/tour/agent-tour";
import { EDITING_TOUR } from "@/components/tour/editing-tour";
import { GENERAL_TOUR } from "@/components/tour/general-tour";
import { LINKING_TOUR } from "@/components/tour/linking-tour";
import { NOTIFICATION_TOUR } from "@/components/tour/notification-tour";
import type { Tour } from "@/components/tour/tour";

/**
 * The walkthroughs on offer, in the order they are listed.
 *
 * One tour of the whole product was the wrong shape: most people arrive
 * wanting one thing — to write a page, to stop being notified about
 * everything, to get their coding agent reading the wiki — and sitting
 * through the other twenty steps to reach it is not a tour, it is a toll.
 *
 * The general one leads because it is the only one that assumes nothing.
 * The rest are ordered roughly by how soon someone needs them.
 */
export const TOURS: readonly Tour[] = [
  {
    id: "general",
    name: "Getting around",
    blurb: "How little there is, both ways of reading it, and what a space holds.",
    steps: GENERAL_TOUR,
  },
  {
    id: "editing",
    name: "Writing a page",
    blurb: "Making one, connecting it, who hears about it, and whose page it is.",
    steps: EDITING_TOUR,
  },
  {
    id: "notifications",
    name: "Notifications",
    blurb: "Where they arrive, and choosing what reaches you.",
    steps: NOTIFICATION_TOUR,
  },
  {
    id: "linking",
    name: "Connecting spaces",
    blurb: "Putting a page in another space's related content, and what an edge is.",
    steps: LINKING_TOUR,
  },
  {
    id: "agent",
    name: "The agent and Webex",
    blurb: "Asking TOME, subscribing to calls, and connecting a coding agent.",
    steps: AGENT_TOUR,
  },
];

/** The tour with this id, or undefined if it is not one of ours. */
export function findTour(id: string | null | undefined): Tour | undefined {
  return TOURS.find((tour) => tour.id === id);
}

/** The tour a button asks for when it does not name one. */
export const NOTIFICATIONS_TOUR_ID = "notifications";
