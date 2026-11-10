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

/** The step index within the general tour that points at a given control. */
const stepPointingAt = (anchor: string) =>
  GENERAL_TOUR.findIndex((step) => step.anchor === anchor);

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const planted: HTMLElement[] = [];

/**
 * A control for a step to point at, with the box it occupies.
 *
 * jsdom lays nothing out, so every element it has is zero by zero and the
 * runner would rightly refuse to ring any of them.
 */
function plant(anchor: string, box: Box): HTMLElement {
  const node = document.createElement("div");
  node.setAttribute("data-tour", anchor);
  node.scrollIntoView = jest.fn();
  node.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
    }) as DOMRect;
  document.body.append(node);
  planted.push(node);
  return node;
}

afterEach(() => {
  for (const node of planted.splice(0)) node.remove();
});

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
    // Taller than the window, as a view behind a tab is.
    const panel = plant("hub-tab-functions", {
      top: 0,
      left: 0,
      width: 900,
      height: 4000,
    });

    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "general",
        index: stepAsking("/projects?tab=functions"),
        subject: null,
      }),
    );

    render(<TourRunner />);

    await waitFor(() => expect(panel.scrollIntoView).toHaveBeenCalled());
    expect(panel.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    );
    const spotlight = await screen.findByTestId("tour-spotlight");
    expect(spotlight.style.height).not.toBe("4000px");
  });

  it("rings the part of it on screen when its own top has scrolled away", async () => {
    // A region the reader has already scrolled into, or one the page moved
    // under after the step scrolled to it. Banding from the region's own top
    // put the ring above the window, where it pointed at nothing and took
    // the card with it.
    query = "tab=functions";
    plant("hub-tab-functions", {
      top: -600,
      left: 0,
      width: 900,
      height: 4000,
    });

    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "general",
        index: stepAsking("/projects?tab=functions"),
        subject: null,
      }),
    );

    render(<TourRunner />);

    const spotlight = await screen.findByTestId("tour-spotlight");
    await waitFor(() => expect(spotlight.style.top).toBe("-4px"));
    expect(parseFloat(spotlight.style.height)).toBeLessThan(window.innerHeight);
  });
});

describe("an anchor that is in the document more than once", () => {
  it("rings the copy the reader can see", async () => {
    // The same control in two places — a project's header and its settings,
    // say — where the one that comes first is the one off screen.
    plant("hub-search", { top: -400, left: 0, width: 120, height: 32 });
    plant("hub-search", { top: 220, left: 48, width: 224, height: 32 });

    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "general",
        index: stepPointingAt("hub-search"),
        subject: null,
      }),
    );

    render(<TourRunner />);

    const spotlight = await screen.findByTestId("tour-spotlight");
    await waitFor(() => expect(spotlight.style.top).toBe("216px"));
    expect(spotlight.style.left).toBe("44px");
  });
});

describe("the scroll a step makes to reach its anchor", () => {
  it("is followed to where the control comes to rest", async () => {
    // Timers are held so nothing but the settle can move the ring: the poll
    // would have corrected this a tenth of a second later, with the reader
    // watching the ring sit beside the control and then step onto it.
    jest.useFakeTimers();
    const frames = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });
    const box = { top: 900, left: 48, width: 224, height: 32 };
    const field = plant("hub-search", box);
    field.scrollIntoView = jest.fn(() => {
      box.top = 300;
    });

    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "general",
        index: stepPointingAt("hub-search"),
        subject: null,
      }),
    );

    render(<TourRunner />);
    await act(async () => {});

    expect(field.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByTestId("tour-spotlight").style.top).toBe("296px");

    frames.mockRestore();
    jest.useRealTimers();
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
