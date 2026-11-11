/**
 * The walkthrough about connecting two spaces, which is the only one that
 * visits two.
 *
 * So that is what these check: that it really crosses — the far end is a
 * different space from the one the page was written in, which is the whole
 * thing a reader is here to see — and that it says so plainly when the
 * reader can only read one space, rather than walking them in a circle.
 */

import { LINKING_TOUR } from "../linking-tour";
import type { TourSubject } from "../tour";

const TWO_SPACES: TourSubject = {
  slug: "example-project",
  pagePath: "charter.md",
  otherSlug: "example-other-project",
};
const ONE_SPACE: TourSubject = {
  slug: "example-project",
  pagePath: "charter.md",
  otherSlug: null,
};

function step(id: string) {
  const found = LINKING_TOUR.find((entry) => entry.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
}

/** The steps whose subject is the space at the far end of the connection. */
const FAR_END = ["related", "mentions", "overview"];

describe("the walkthrough about connecting spaces", () => {
  it("walks from the page to the space it reaches", () => {
    expect(LINKING_TOUR.map((entry) => entry.id)).toEqual([
      "why",
      "connect",
      ...FAR_END,
    ]);
  });

  it("makes the connection on the page the subject borrowed", () => {
    expect(step("connect").route?.(TWO_SPACES)).toBe(
      "/projects/example-project/tome/wiki/charter.md",
    );
  });

  // The point of the tour. A far end in the same space as the near end would
  // leave a reader looking at the page they started on and wondering what
  // they were being shown.
  it("crosses to the other space, and never back to the first", () => {
    for (const id of FAR_END) {
      const where = step(id).route?.(TWO_SPACES);
      expect(where).toContain("/projects/example-other-project/");
      expect(where).not.toContain("/projects/example-project/");
    }
  });

  it("ends on the other space's own Home", () => {
    expect(step("overview").route?.(TWO_SPACES)).toBe(
      "/projects/example-other-project/tome",
    );
  });

  it("says what is missing when there is only one space to read", () => {
    for (const id of FAR_END) {
      expect(step(id).route?.(ONE_SPACE)).toBeNull();
      expect(step(id).unavailable).toBeTruthy();
    }
    // And the steps before the crossing are unaffected: one space is enough
    // to be shown how a connection is made.
    expect(step("connect").route?.(ONE_SPACE)).not.toBeNull();
  });

  // Shown rather than made: the far end is whatever the deployment already
  // has. Only the control that makes one is pressed, and that is put back.
  it("opens the picker and nothing else", () => {
    const opened = LINKING_TOUR.flatMap((entry) => [...(entry.opens ?? [])]);
    expect(opened).toEqual(["page-edit", "page-tags"]);
  });
});
