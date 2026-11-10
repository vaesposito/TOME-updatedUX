/** @jest-environment jsdom */

import {
  FEATURE_TOUR,
  FEATURE_TOUR_STATE_KEY,
} from "../feature-tour";
import { NOTIFICATION_TOUR, TOUR_STATE_KEY } from "../notification-tour";
import { isTourRunning, type TourSubject } from "../tour";

const HAS_PROJECT: TourSubject = {
  slug: "example-project",
  pagePath: "charter.md",
};
const NOTHING: TourSubject = { slug: null, pagePath: null };

function step(id: string) {
  const found = FEATURE_TOUR.find((entry) => entry.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
}

describe("the features walkthrough", () => {
  it("runs from the catalogue into a project and out to MCP", () => {
    expect(FEATURE_TOUR.map((entry) => entry.id)).toEqual([
      "axes",
      "search",
      "create",
      "home",
      "wiki",
      "mcp",
    ]);
  });

  // A card floating in the middle of the window describing something that
  // is not on screen is a slideshow, and the walkthrough dialog does those.
  it("points every step at a real control", () => {
    for (const entry of FEATURE_TOUR) {
      expect(entry.anchor).toBeTruthy();
      expect(entry.title).toBeTruthy();
      expect(entry.body).toBeTruthy();
    }
  });

  it("keeps the catalogue steps on the catalogue", () => {
    for (const id of ["axes", "search", "create", "mcp"]) {
      expect(step(id).route?.(NOTHING)).toBe("/projects");
    }
  });

  it("borrows one project for the two steps inside one", () => {
    expect(step("home").route?.(HAS_PROJECT)).toBe(
      "/projects/example-project/tome",
    );
    expect(step("wiki").route?.(HAS_PROJECT)).toBe(
      "/projects/example-project/tome/wiki/charter.md",
    );
  });

  it("says what is missing rather than pointing at nothing", () => {
    for (const id of ["home", "wiki"]) {
      expect(step(id).route?.(NOTHING)).toBeNull();
      expect(step(id).unavailable).toBeTruthy();
    }
  });

  // A project with no wiki page still has a Home worth showing.
  it("still opens a project that has no pages", () => {
    const empty: TourSubject = { slug: "example-project", pagePath: null };
    expect(step("home").route?.(empty)).toBe("/projects/example-project/tome");
    expect(step("wiki").route?.(empty)).toBeNull();
  });
});

describe("two tours side by side", () => {
  afterEach(() => window.sessionStorage.clear());

  // Each keeps its own place, or finishing one would drop the reader into
  // the middle of the other the next time they started it.
  it("keeps their places apart", () => {
    expect(FEATURE_TOUR_STATE_KEY).not.toBe(TOUR_STATE_KEY);
    expect(FEATURE_TOUR).not.toBe(NOTIFICATION_TOUR);
  });

  // Dialogs that open themselves on arrival check this before they do, and
  // either tour walking into a project is reason enough to hold off.
  it("reports either one as running", () => {
    expect(isTourRunning()).toBe(false);
    window.sessionStorage.setItem(
      FEATURE_TOUR_STATE_KEY,
      JSON.stringify({ index: 1 }),
    );
    expect(isTourRunning()).toBe(true);
  });
});
