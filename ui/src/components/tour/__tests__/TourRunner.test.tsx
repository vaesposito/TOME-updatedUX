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

describe("borrowing something to show", () => {
  it("opens a page from a project the reader can read but does not watch", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("/api/notifications/following")
        ? { data: { nodes: [] } }
        : url.includes("/api/projects")
          ? { data: { projects: [{ slug: "example-project" }] } }
          : { data: { pages: { "charter.md": "" } } };
      return { ok: true, json: async () => payload };
    }) as unknown as typeof fetch;

    render(<TourRunner />);

    act(() => {
      startTour("editing");
    });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/projects/example-project/tome/wiki/charter.md",
      ),
    );
  });
});

describe("the borrowed project", () => {
  it("is looked up once, not again for the next tour", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const payload = url.includes("/api/notifications/following")
        ? { data: { nodes: [] } }
        : url.includes("/api/projects")
          ? { data: { projects: [{ slug: "example-project" }] } }
          : { data: { pages: { "charter.md": "" } } };
      return { ok: true, json: async () => payload };
    }) as unknown as typeof fetch;

    const { unmount } = render(<TourRunner />);
    act(() => {
      startTour("editing");
    });
    await waitFor(() => expect(push).toHaveBeenCalled());
    unmount();
    calls.length = 0;

    render(<TourRunner />);
    act(() => {
      startTour("agent");
    });
    // Past the grace a step with no anchor on screen is given, so the tour
    // has certainly done whatever asking it was going to do.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument(), {
      timeout: 3000,
    });

    expect(calls).toEqual([]);
  });
});

describe("a step about a whole panel", () => {
  it("rings the top of it and brings that to the top of the window", async () => {
    query = "tab=functions";
    const panel = document.createElement("div");
    panel.setAttribute("data-tour", "hub-tab-functions");
    const scrollIntoView = jest.fn();
    panel.scrollIntoView = scrollIntoView;
    // Taller than the window, as a view behind a tab is.
    panel.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 900, height: 4000 }) as DOMRect;
    document.body.append(panel);

    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "general",
        index: stepAsking("/projects?tab=functions"),
        subject: null,
      }),
    );

    render(<TourRunner />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    );
    const spotlight = await screen.findByTestId("tour-spotlight");
    expect(spotlight.style.height).not.toBe("4000px");

    panel.remove();
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
