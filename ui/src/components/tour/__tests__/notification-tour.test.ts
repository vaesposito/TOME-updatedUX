/** @jest-environment jsdom */

import {
  NOTIFICATION_TOUR,
  TOUR_STATE_KEY,
  isTourRunning,
  samePath,
  type TourSubject,
} from "../notification-tour";

const HAS_PROJECT: TourSubject = {
  slug: "example-project",
  pagePath: "charter.md",
  otherSlug: "example-other-project",
};
const NOTHING: TourSubject = { slug: null, pagePath: null, otherSlug: null };

function step(id: string) {
  const found = NOTIFICATION_TOUR.find((entry) => entry.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
}

describe("the notifications walkthrough", () => {
  it("covers the five places in the order they are met", () => {
    expect(NOTIFICATION_TOUR.map((entry) => entry.id)).toEqual([
      "bell",
      "following",
      "watch",
      "notify",
      "summary",
    ]);
  });

  // The bell is in the header of every page, so pinning it to a route would
  // march the reader off whatever they were looking at to start.
  it("starts where the reader already is", () => {
    expect(step("bell").route).toBeUndefined();
  });

  // Notifications are read at the bell and chosen in settings, so the step
  // about choosing is the only one that has anywhere of its own to go.
  it("sends the step about choosing to settings", () => {
    expect(step("following").route?.(NOTHING)).toBe("/settings/notifications");
  });

  it("keeps the project steps on one project", () => {
    expect(step("watch").route?.(HAS_PROJECT)).toBe(
      "/projects/example-project/tome",
    );
    expect(step("summary").route?.(HAS_PROJECT)).toBe(
      "/projects/example-project/tome",
    );
    expect(step("notify").route?.(HAS_PROJECT)).toBe(
      "/projects/example-project/tome/wiki/charter.md",
    );
  });

  it("has nowhere to send a reader with no readable project", () => {
    for (const id of ["watch", "notify", "summary"]) {
      expect(step(id).route?.(NOTHING)).toBeNull();
      expect(step(id).unavailable).toBeTruthy();
    }
  });

  // A project with no wiki page can still show its Watch button and its
  // Home; only the step about saving a page has nothing to open.
  it("still visits a project that has no pages", () => {
    const empty: TourSubject = {
      slug: "example-project",
      pagePath: null,
      otherSlug: null,
    };
    expect(step("watch").route?.(empty)).toBe("/projects/example-project/tome");
    expect(step("summary").route?.(empty)).toBe("/projects/example-project/tome");
    expect(step("notify").route?.(empty)).toBeNull();
  });

  // Every step whose subject only exists in a particular state needs both a
  // way in to point at and something to say while it waits.
  it("explains how to reveal a hidden subject", () => {
    for (const entry of NOTIFICATION_TOUR) {
      if (entry.waitingAnchor) expect(entry.hint).toBeTruthy();
    }
    expect(step("notify").waitingAnchor).toBe("page-edit");
  });
});

describe("samePath", () => {
  it("matches a path to itself", () => {
    expect(samePath("/settings/notifications", "/settings/notifications")).toBe(true);
    expect(samePath("/settings/notifications", "/projects")).toBe(false);
  });

  // A wiki path is pushed encoded and read back from the router in whichever
  // form the browser settled on. Comparing raw strings would leave the step
  // thinking it had never arrived, and pushing its own route forever.
  it("sees through the encoding a page path picks up in transit", () => {
    const encoded = step("notify").route?.({
      slug: "example-project",
      pagePath: "design notes/a b.md",
    });
    expect(encoded).toBe(
      "/projects/example-project/tome/wiki/design%20notes/a%20b.md",
    );
    expect(
      samePath(
        encoded as string,
        "/projects/example-project/tome/wiki/design notes/a b.md",
      ),
    ).toBe(true);
  });

  it("falls back to the raw strings when one will not decode", () => {
    expect(samePath("/wiki/%E0%A4%A", "/wiki/%E0%A4%A")).toBe(true);
  });

  // A host that serves pages as directories answers with a trailing slash,
  // while steps are written without one. Treating those as different places
  // left a step pushing its own route, being redirected back, and never
  // showing itself.
  it("treats a trailing slash as the same place", () => {
    expect(
      samePath(
        "/projects/example-project/tome/wiki/overview.md",
        "/projects/example-project/tome/wiki/overview.md/",
      ),
    ).toBe(true);
    expect(samePath("/projects/", "/projects")).toBe(true);
    expect(samePath("/", "/")).toBe(true);
  });

  it("keeps the query when a slash is trimmed", () => {
    expect(samePath("/projects/?tab=digest", "/projects?tab=digest")).toBe(true);
    expect(samePath("/projects/?tab=digest", "/projects?tab=overview")).toBe(
      false,
    );
  });
});

describe("isTourRunning", () => {
  afterEach(() => window.sessionStorage.clear());

  it("is false with nothing stored", () => {
    expect(isTourRunning()).toBe(false);
  });

  it("is true part-way through, so arrival dialogs hold off", () => {
    window.sessionStorage.setItem(TOUR_STATE_KEY, JSON.stringify({ index: 2 }));
    expect(isTourRunning()).toBe(true);
  });
});
