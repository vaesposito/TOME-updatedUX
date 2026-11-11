import type { TourStep } from "@/components/tour/tour";

/** What every step after the first needs open, and the way in to it. */
const IN_THE_PANEL = "ask-tome" as const;

const OPEN_IT = "Choose Ask Tome — the rest of this walkthrough is inside it.";

/**
 * The agent, and the two other places it can be reached.
 *
 * Every step but the first is inside the panel, so each of them names the
 * launcher first in what it opens: a run of steps that all ask for the same
 * control keeps it open between them rather than shutting the panel and
 * pressing it again, which would have the reader watching it blink four
 * times. The hint is what is left when the launcher cannot be pressed.
 *
 * Only the first step has anywhere to go. The panel follows the reader
 * around the application, so a later step with a route would be a page load
 * that closed the thing it was about — and neither of the two places the
 * last step names is a page this build exports.
 */
export const AGENT_TOUR: readonly TourStep[] = [
  {
    id: "ask",
    anchor: "ask-tome",
    opens: [IN_THE_PANEL],
    route: () => "/projects",
    title: "Ask TOME from anywhere",
    body:
      "The panel follows you around the application, and answers from every wiki you can read rather than from whichever page you happen to be standing on. Drag its edges if it is in the way; it remembers the size.",
  },
  {
    id: "webex",
    // The note rather than the button that produces it: the three lines
    // inside are the whole of what this step has to say.
    anchor: "ask-webex-note",
    waitingAnchor: IN_THE_PANEL,
    opens: [IN_THE_PANEL, "ask-webex"],
    hint: OPEN_IT,
    title: "Or reach the same agent in Webex",
    body:
      "Configure Webex gives you the three things you need to start: go to Webex, search for the address it names, and open a conversation with the agent. It answers there from the same wikis, so a question asked between meetings does not have to wait for you to be back at this panel. Drag the note somewhere it is not in the way while you do it.",
  },
  {
    id: "history",
    anchor: "ask-history",
    waitingAnchor: IN_THE_PANEL,
    // Pressed, so the rows are on the screen while the step is read. Putting
    // it back is the tab bar's own business: pressing a tab twice only
    // chooses it again, so the runner hands back the tab that was chosen
    // before it, which is Chat.
    opens: [IN_THE_PANEL, "ask-history"],
    hint: OPEN_IT,
    title: "Everything you have asked it before",
    body:
      "History lists your past conversations with the agent, newest first. Opening one puts it back in the panel where you left it, so a question you asked last week is somewhere to carry on from rather than something to ask again.",
  },
  {
    id: "elsewhere",
    anchor: "ask-new-window",
    waitingAnchor: IN_THE_PANEL,
    // The launcher only. This control is shut by design, and a step must
    // never ask the runner to press something that does nothing.
    opens: [IN_THE_PANEL],
    hint: OPEN_IT,
    title: "The same conversation, with room to work",
    body:
      "This takes the conversation out of the corner and into the chat space, where it has the width of the page. The same agent is listed there among GRID's agents, alongside the others your deployment runs — this panel is one way in rather than the only one.",
  },
];
