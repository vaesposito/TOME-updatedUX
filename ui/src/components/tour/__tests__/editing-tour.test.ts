/**
 * The walkthrough about writing a page, which is the only one that asks the
 * reader to make something.
 *
 * That is what these check. A tour is data, and a tour built around a
 * creation goes wrong in two ways the others cannot: it presses the button
 * that creates, or it routes somewhere after the creation and marches the
 * reader off the page they have just written. The second is the quiet one —
 * the new page's address did not exist when the subject was resolved, so any
 * route a later step named would be somewhere else.
 */

import { EDITING_TOUR } from "../editing-tour";
import type { TourSubject } from "../tour";

const HAS_PROJECT: TourSubject = {
  slug: "example-project",
  pagePath: "charter.md",
};
const NOTHING: TourSubject = { slug: null, pagePath: null };

/** Which step creates the page; everything after it is on a page that is new. */
const CREATES = "new";

function step(id: string) {
  const found = EDITING_TOUR.find((entry) => entry.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
}

describe("the walkthrough about writing a page", () => {
  it("runs from making the page to what the agent does with it", () => {
    expect(EDITING_TOUR.map((entry) => entry.id)).toEqual([
      CREATES,
      "connect",
      "notify",
      "kind",
      "prompts",
    ]);
  });

  it("starts on the wiki's own index, where New page is", () => {
    expect(step(CREATES).route?.(HAS_PROJECT)).toBe(
      "/projects/example-project/tome/wiki",
    );
    expect(step(CREATES).route?.(NOTHING)).toBeNull();
    expect(step(CREATES).unavailable).toBeTruthy();
  });

  // The one assertion the other tours do not need. The page a reader makes
  // here was not in the subject the runner resolved before the tour started,
  // so a later step with a route would send them to a different page — and a
  // route that comes back empty is not the same thing as none at all: that
  // tells the reader the step cannot be shown.
  it("sends nobody anywhere once the page has been made", () => {
    const after = EDITING_TOUR.slice(
      EDITING_TOUR.findIndex((entry) => entry.id === CREATES) + 1,
    );
    expect(after).not.toHaveLength(0);
    for (const entry of after) {
      expect(entry.route).toBeUndefined();
      expect(entry.unavailable).toBeUndefined();
    }
  });

  it("never presses the controls that make the page", () => {
    for (const entry of EDITING_TOUR) {
      expect(entry.opens ?? []).not.toContain("wiki-new-page");
    }
  });

  it("waits on the way in, and says what to do while it waits", () => {
    for (const entry of EDITING_TOUR.slice(1)) {
      expect(entry.waitingAnchor).toBeTruthy();
      expect(entry.hint).toBeTruthy();
    }
  });

  // A new page is stable, so it has no prompts until its kind is changed.
  // The step about the prompts has to come after the one about the kind, and
  // has to wait on the kind rather than on the editor.
  it("asks for the kind before it asks about the prompts", () => {
    const ids = EDITING_TOUR.map((entry) => entry.id);
    expect(ids.indexOf("kind")).toBeLessThan(ids.indexOf("prompts"));
    expect(step("prompts").waitingAnchor).toBe("page-kind");
  });
});
