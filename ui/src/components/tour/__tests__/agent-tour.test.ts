/**
 * The walkthrough about the agent, which is the only one that lives inside a
 * single panel.
 *
 * Which is what these check. Everything after the first step is behind the
 * launcher, so every one of them has to name it first in what it opens —
 * that is what keeps the panel open between them instead of shutting and
 * re-opening it under the reader — and none of them may go anywhere, since a
 * page load would close the thing the step is about.
 */

import { AGENT_TOUR } from "../agent-tour";
import type { TourSubject } from "../tour";

const NOTHING: TourSubject = { slug: null, pagePath: null, otherSlug: null };

describe("the walkthrough about the agent", () => {
  it("covers the panel, Webex, the history and the way out", () => {
    expect(AGENT_TOUR.map((step) => step.id)).toEqual([
      "ask",
      "webex",
      "history",
      "elsewhere",
    ]);
  });

  it("opens the panel first on every step that is inside it", () => {
    for (const step of AGENT_TOUR) {
      expect(step.opens?.at(0)).toBe("ask-tome");
    }
  });

  it("waits on the launcher, and says so, wherever its subject is hidden", () => {
    for (const step of AGENT_TOUR.slice(1)) {
      expect(step.waitingAnchor).toBe("ask-tome");
      expect(step.hint).toBeTruthy();
    }
  });

  // The panel follows the reader around, so there is nothing to navigate to
  // — and both places the last step names are addresses this build does not
  // export, so pointing at them is all it can honestly do.
  it("goes to the catalogue and then stays put", () => {
    expect(AGENT_TOUR[0]?.route?.(NOTHING)).toBe("/projects");
    for (const step of AGENT_TOUR.slice(1)) {
      expect(step.route).toBeUndefined();
    }
  });

  // Shut by design: it opens the same question in the chat space, and there
  // is no conversation here to carry over. A step that asked the runner to
  // press it would wait on it for the whole of the grace period and then
  // give up, which reads as a tour that lost its place.
  it("never asks for the control that is shut on purpose", () => {
    for (const step of AGENT_TOUR) {
      expect(step.opens ?? []).not.toContain("ask-new-window");
    }
    expect(AGENT_TOUR.at(-1)?.anchor).toBe("ask-new-window");
  });
});
