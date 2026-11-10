/**
 * The walkthroughs on offer, checked for the things a reader would notice.
 *
 * A tour is data, and the ways it goes wrong are the ways data goes wrong:
 * two steps sharing an id so the runner cannot tell them apart, a step that
 * can fail to find its subject without saying so, or a chooser entry with
 * nothing to choose.
 */

import { findTour, TOURS } from "../tour-catalog";

describe("the catalogue", () => {
  it("offers the five walkthroughs, each with something to show", () => {
    expect(TOURS.map((tour) => tour.id)).toEqual([
      "general",
      "editing",
      "notifications",
      "linking",
      "agent",
    ]);
    for (const tour of TOURS) {
      expect(tour.steps.length).toBeGreaterThan(0);
      expect(tour.name).not.toHaveLength(0);
      expect(tour.blurb).not.toHaveLength(0);
    }
  });

  it("gives every step an id its own tour uses once", () => {
    for (const tour of TOURS) {
      const ids = tour.steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("says what is missing wherever a step can fail to find its subject", () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        if (!step.route) continue;
        const nowhere = step.route({ slug: null, pagePath: null });
        if (nowhere === null) {
          expect(step.unavailable).toBeDefined();
        }
      }
    }
  });

  it("pairs a hint with every step that waits somewhere else", () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        if (step.waitingAnchor) expect(step.hint).toBeDefined();
      }
    }
  });

  it("knows its own tours and no others", () => {
    expect(findTour("general")?.name).toBe("Getting around");
    expect(findTour("retired")).toBeUndefined();
    expect(findTour(null)).toBeUndefined();
  });
});
