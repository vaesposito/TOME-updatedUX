/** @jest-environment jsdom */

/**
 * What the runner does with a tour it has been handed.
 *
 * Three things that were each a bug: a step with nothing to point at drawn
 * over a fully lit page, so it read as a stray dialog; a request for a tour
 * nobody wrote starting the first one instead; and a step asking for a tab
 * believing it had arrived because the path already matched.
 */

import { act, render, screen, waitFor } from "@testing-library/react";

import { TourRunner } from "../TourRunner";
import { GENERAL_TOUR } from "../general-tour";
import { startTour, TOUR_STATE_KEY } from "../tour";

const push = jest.fn();
let pathname = "/projects";
let query = "";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(query),
}));

/** The step index within the general tour that asks for a given route. */
const stepAsking = (route: string) =>
  GENERAL_TOUR.findIndex(
    (step) => step.route?.({ slug: null, pagePath: null }) === route,
  );

beforeEach(() => {
  push.mockClear();
  pathname = "/projects";
  query = "";
  window.sessionStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { nodes: [] } }),
  }) as unknown as typeof fetch;
});

describe("starting a tour", () => {
  it("runs the one that was asked for", async () => {
    render(<TourRunner />);

    act(() => {
      startTour("linking");
    });

    expect(await screen.findByText("Nothing is only in one place")).toBeInTheDocument();
  });

  it("starts nothing when asked for a tour we do not have", () => {
    render(<TourRunner />);

    act(() => {
      startTour("not-a-tour");
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("a step with no control to point at", () => {
  it("is shown over a dimmed page, like an anchored one", async () => {
    render(<TourRunner />);

    act(() => {
      startTour("linking");
    });

    await waitFor(() =>
      expect(screen.getByTestId("tour-backdrop")).toBeInTheDocument(),
    );
  });
});

describe("a step that asks for a tab", () => {
  it("routes there even though the path already matches", async () => {
    const index = stepAsking("/projects?tab=overview");
    expect(index).toBeGreaterThan(-1);
    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({ tour: "general", index, subject: null }),
    );

    render(<TourRunner />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects?tab=overview"));
  });

  it("stays put once that tab is the one showing", async () => {
    query = "tab=overview";
    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "general",
        index: stepAsking("/projects?tab=overview"),
        subject: null,
      }),
    );

    render(<TourRunner />);

    // Long enough for the step to have routed if it thought it had to. The
    // card itself stays hidden here: its anchor is on the real Overview
    // panel, which this test does not render.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("a saved place", () => {
  it("is dropped when it names a tour we no longer have", () => {
    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({ tour: "retired", index: 0, subject: null }),
    );

    render(<TourRunner />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
