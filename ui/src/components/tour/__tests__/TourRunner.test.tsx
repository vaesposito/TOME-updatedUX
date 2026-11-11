/** @jest-environment jsdom */

/**
 * What the runner does with a tour it has been handed.
 *
 * Three things that were each a bug: a step with nothing to point at drawn
 * over a fully lit page, so it read as a stray dialog; a request for a tour
 * nobody wrote starting the first one instead; and a step asking for a tab
 * believing it had arrived because the path already matched.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TourRunner } from "../TourRunner";
import { EDITING_TOUR } from "../editing-tour";
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

/** Give an element a box, which jsdom lays out as zero by zero otherwise. */
function size(node: HTMLElement, box: Box): HTMLElement {
  node.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
    }) as DOMRect;
  return node;
}

/**
 * A control for a step to point at, with the box it occupies.
 *
 * jsdom lays nothing out, so every element it has is zero by zero and the
 * runner would rightly refuse to ring any of them.
 */
function plant(anchor: string, box: Box, tag = "div"): HTMLElement {
  const node = document.createElement(tag);
  node.setAttribute("data-tour", anchor);
  size(node, box);
  document.body.append(node);
  planted.push(node);
  return node;
}

/** How often the runner looks again for something that was not there yet. */
const POLL = 100;

/** How far the page has been asked to scroll, since jsdom does not scroll. */
let scrolledBy: jest.Mock;

/** The other way to scroll, which jsdom has no implementation of at all. */
let scrolledInto: jest.Mock;

afterEach(() => {
  for (const node of planted.splice(0)) node.remove();
});

beforeEach(() => {
  push.mockClear();
  pathname = "/projects";
  query = "";
  window.sessionStorage.clear();
  scrolledBy = jest.fn();
  window.scrollBy = scrolledBy as unknown as typeof window.scrollBy;
  scrolledInto = jest.fn();
  Element.prototype.scrollIntoView =
    scrolledInto as unknown as typeof Element.prototype.scrollIntoView;
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

describe("a step reached across a page load", () => {
  // Wherever pages are served as directories, a step asks for a path written
  // without a trailing slash and the host answers with one. The redirect is a
  // fresh page load, so everything the runner held in state goes — and the
  // request for the next step went with it, leaving the tour on the step it
  // had left, whose own route sent the reader back. Next did nothing at all.
  it("finishes the step it was reaching for", async () => {
    const reaching = stepPointingAt("project-home");
    expect(reaching).toBeGreaterThan(-1);
    pathname = "/projects/example-project/tome";
    plant("project-home", { top: 10, left: 0, width: 400, height: 200 });
    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "general",
        index: 0,
        subject: { slug: "example-project", pagePath: "overview.md" },
        pending: reaching,
      }),
    );

    render(<TourRunner />);

    expect(
      await screen.findByText(GENERAL_TOUR[reaching]?.title as string),
    ).toBeInTheDocument();
    // And it does not bounce back to where the step it left belonged.
    expect(push).not.toHaveBeenCalledWith("/projects");
  });

  // The linking tour opens on a step with nothing to point at, which is the
  // one kind that shows in jsdom without a control being planted for it.
  it("keeps the request where a page load can find it", async () => {
    pathname = "/projects";
    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "linking",
        index: 0,
        // A page to go to, so the next step really does cross a page rather
        // than being reached where the reader already stands.
        subject: { slug: "example-project", pagePath: "overview.md" },
      }),
    );

    render(<TourRunner />);
    await screen.findByText("Nothing is only in one place");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/projects/example-project/tome/wiki/overview.md",
      ),
    );
    const saved = JSON.parse(
      window.sessionStorage.getItem(TOUR_STATE_KEY) ?? "{}",
    );
    expect(saved.pending).toBe(1);
    expect(saved.index).toBe(0);
  });

  it("ignores a saved request that is not a step", async () => {
    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "linking",
        index: 0,
        subject: null,
        pending: 99,
      }),
    );

    render(<TourRunner />);

    expect(
      await screen.findByText("Nothing is only in one place"),
    ).toBeInTheDocument();
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
    // Taller than the window, as a view behind a tab is, and starting below
    // the fold so there is something to scroll.
    plant("hub-tab-functions", {
      top: 200,
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

    // To its top, not to its middle: 200 down less the margin a heading is
    // given, rather than far enough to put the reader inside it.
    await waitFor(() => expect(scrolledBy).toHaveBeenCalled());
    expect(scrolledBy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 188 }),
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
    plant("hub-search", box);
    scrolledBy.mockImplementation(() => {
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

    expect(scrolledBy).toHaveBeenCalled();
    expect(screen.getByTestId("tour-spotlight").style.top).toBe("296px");

    frames.mockRestore();
    jest.useRealTimers();
  });
});

describe("the scroll a step makes to reach its anchor", () => {
  /** A panel between the anchor and the page, with its own scroll state. */
  function wrap(
    child: HTMLElement,
    overflow: string,
    box: Box,
    content: number,
  ): HTMLElement {
    const panel = size(document.createElement("div"), box);
    panel.style.overflowY = overflow;
    Object.defineProperty(panel, "scrollHeight", { value: content });
    Object.defineProperty(panel, "clientHeight", { value: box.height });
    panel.scrollBy = jest.fn();
    child.replaceWith(panel);
    panel.append(child);
    planted.push(panel);
    return panel;
  }

  it("moves only what the reader could move themselves", async () => {
    // The application shell is `overflow: hidden` and taller than the
    // window, which makes it scrollable to a script and immovable to a
    // wheel. A step that scrolled it left the whole product sitting under
    // its own header with no way for the reader to put it back.
    const field = plant("hub-search", {
      top: 900,
      left: 48,
      width: 224,
      height: 32,
    });
    const inner = wrap(
      field,
      "auto",
      { top: 100, left: 0, width: 1024, height: 600 },
      2000,
    );
    const shell = wrap(
      inner,
      "hidden",
      { top: 0, left: 0, width: 1024, height: 768 },
      2000,
    );

    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "general",
        index: stepPointingAt("hub-search"),
        subject: null,
      }),
    );

    render(<TourRunner />);

    await waitFor(() => expect(inner.scrollBy).toHaveBeenCalled());
    expect(inner.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 516 }),
    );
    expect(shell.scrollBy).not.toHaveBeenCalled();
    expect(scrolledBy).not.toHaveBeenCalled();
    // `scrollIntoView` is what moved every one of them at once.
    expect(scrolledInto).not.toHaveBeenCalled();
  });

  it("is not made at all for a control already in front of the reader", async () => {
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

    await screen.findByTestId("tour-spotlight");
    expect(scrolledBy).not.toHaveBeenCalled();
    expect(scrolledInto).not.toHaveBeenCalled();
  });
});

describe("a step whose subject is behind a button", () => {
  /** The bell, which the first notifications step both opens and rings. */
  function bell(): HTMLElement {
    return plant(
      "notifications-bell",
      { top: 8, left: 900, width: 32, height: 32 },
      "button",
    );
  }

  function startAtTheBell(): void {
    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({ tour: "notifications", index: 0, subject: null }),
    );
  }

  it("presses it, so the step describes something on the screen", async () => {
    const button = bell();
    const clicks = jest.fn();
    button.addEventListener("click", clicks);
    startAtTheBell();

    render(<TourRunner />);

    await waitFor(() => expect(clicks).toHaveBeenCalledTimes(1));
  });

  it("leaves it alone when the reader has already opened it", async () => {
    const button = bell();
    button.setAttribute("aria-expanded", "true");
    const clicks = jest.fn();
    button.addEventListener("click", clicks);
    startAtTheBell();

    render(<TourRunner />);

    await screen.findByTestId("tour-spotlight");
    expect(clicks).not.toHaveBeenCalled();
  });

  it("presses it again when the tour ends, so the page is as it was", async () => {
    const button = bell();
    const clicks = jest.fn();
    button.addEventListener("click", clicks);
    startAtTheBell();

    render(<TourRunner />);
    await waitFor(() => expect(clicks).toHaveBeenCalledTimes(1));

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    await waitFor(() => expect(clicks).toHaveBeenCalledTimes(2));
  });

  it("presses a tab the way a mouse does, and only once", async () => {
    // Radix's tabs answer the pointer going down and never see a bare
    // click, so the step about Following used to ring the tab and leave the
    // reader looking at the inbox. Pressing both ways would open the tab
    // and shut it again.
    pathname = "/notifications";
    const tab = plant(
      "notifications-watching",
      { top: 60, left: 300, width: 96, height: 32 },
      "button",
    );
    tab.setAttribute("aria-selected", "false");
    tab.addEventListener("mousedown", () =>
      tab.setAttribute("aria-selected", "true"),
    );
    const clicks = jest.fn();
    tab.addEventListener("click", clicks);

    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({ tour: "notifications", index: 2, subject: null }),
    );

    render(<TourRunner />);

    await waitFor(() =>
      expect(tab.getAttribute("aria-selected")).toBe("true"),
    );
    expect(clicks).not.toHaveBeenCalled();
  });

  it("gives the tab the reader was on back when the tour ends", async () => {
    // Pressing a tab a second time only chooses it again, so a step that
    // opened Following would hand back a page nobody asked to be on.
    pathname = "/notifications";
    const list = document.createElement("div");
    list.setAttribute("role", "tablist");
    document.body.append(list);
    planted.push(list);

    const inbox = size(document.createElement("button"), {
      top: 60,
      left: 200,
      width: 80,
      height: 32,
    });
    inbox.setAttribute("role", "tab");
    inbox.setAttribute("aria-selected", "true");
    const following = plant(
      "notifications-watching",
      { top: 60, left: 300, width: 96, height: 32 },
      "button",
    );
    following.setAttribute("role", "tab");
    following.setAttribute("aria-selected", "false");
    // A tab bar, as Radix builds one: chosen by the pointer going down.
    for (const [tab, other] of [
      [inbox, following],
      [following, inbox],
    ]) {
      tab.addEventListener("mousedown", () => {
        tab.setAttribute("aria-selected", "true");
        other.setAttribute("aria-selected", "false");
      });
    }
    list.append(inbox, following);

    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({ tour: "notifications", index: 2, subject: null }),
    );

    render(<TourRunner />);
    await waitFor(() =>
      expect(following.getAttribute("aria-selected")).toBe("true"),
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    await waitFor(() =>
      expect(inbox.getAttribute("aria-selected")).toBe("true"),
    );
  });

  it("hangs its card clear of what it opened", async () => {
    const button = bell();
    button.addEventListener("click", () => {
      const panel = size(document.createElement("div"), {
        top: 48,
        left: 600,
        width: 360,
        height: 400,
      });
      panel.setAttribute("data-popover-content", "");
      document.body.append(panel);
      planted.push(panel);
    });
    startAtTheBell();

    render(<TourRunner />);

    // The ring stays on the bell; the card is given the pair of them to
    // hang from, so it cannot land on top of the list being explained.
    const anchor = await screen.findByTestId("tour-card-anchor");
    await waitFor(() => expect(anchor.style.left).toBe("600px"));
    expect(anchor.style.width).toBe("360px");
    expect(anchor.style.height).toBe("440px");
    expect(screen.getByTestId("tour-spotlight").style.left).toBe("896px");
  });
});

describe("a step that opens the editor", () => {
  /** The notifications step about who hears, which opens Edit and the menu. */
  const NOTIFY = 4;

  /** The wiki page the notify step borrows, as a saved place. */
  const onThePage = () => {
    pathname = "/projects/example-project/tome/wiki/charter.md";
    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "notifications",
        index: NOTIFY,
        subject: { slug: "example-project", pagePath: "charter.md" },
      }),
    );
  };

  /**
   * An Edit button that behaves like the page's: it names its way out, and
   * pressing it replaces it with a Cancel that puts the page back.
   */
  function plantEditor(): { press: jest.Mock; cancelled: jest.Mock } {
    const pressed = jest.fn();
    const cancelled = jest.fn();
    const edit = plant(
      "page-edit",
      { top: 60, left: 900, width: 44, height: 28 },
      "button",
    );
    edit.setAttribute("data-tour-undo", "page-cancel");
    edit.addEventListener("click", () => {
      pressed();
      edit.style.display = "none";
      edit.removeAttribute("data-tour");
      const cancel = plant(
        "page-cancel",
        { top: 60, left: 950, width: 60, height: 28 },
        "button",
      );
      cancel.addEventListener("click", () => {
        cancelled();
        cancel.remove();
        edit.style.display = "";
        edit.setAttribute("data-tour", "page-edit");
      });
      plant("page-notify", { top: 60, left: 800, width: 127, height: 28 }, "button");
    });
    return { press: pressed, cancelled };
  }

  it("presses Edit, and presses Cancel on the way out", async () => {
    const editor = plantEditor();
    onThePage();

    render(<TourRunner />);
    await waitFor(() => expect(editor.press).toHaveBeenCalledTimes(1));
    expect(editor.cancelled).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    // Cancel rather than Save, and rather than nothing: the editor writes a
    // draft half a second after it opens, and only Cancel discards it.
    await waitFor(() => expect(editor.cancelled).toHaveBeenCalledTimes(1));
  });

  it("waits for Cancel when the reader leaves before the editor is back", async () => {
    // Opening a page for editing is a round trip. A reader who presses
    // Escape in that second was leaving before there was anything to press.
    jest.useFakeTimers();
    const cancelled = jest.fn();
    const edit = plant(
      "page-edit",
      { top: 60, left: 900, width: 44, height: 28 },
      "button",
    );
    edit.setAttribute("data-tour-undo", "page-cancel");
    let opening = false;
    edit.addEventListener("click", () => {
      opening = true;
    });
    onThePage();

    render(<TourRunner />);
    await act(async () => {
      jest.advanceTimersByTime(POLL);
    });
    expect(opening).toBe(true);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    // The editor arrives after the tour has gone, and is still put back.
    const cancel = plant(
      "page-cancel",
      { top: 60, left: 950, width: 60, height: 28 },
      "button",
    );
    cancel.addEventListener("click", cancelled);
    await act(async () => {
      jest.advanceTimersByTime(POLL * 2);
    });

    expect(cancelled).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("puts the editor back before it navigates, not after", async () => {
    // A step that leaves by going somewhere else has to press Cancel while
    // the page holding it is still there. By the time a route change
    // reaches an effect, it has gone.
    const editor = plantEditor();
    onThePage();

    render(<TourRunner />);
    await waitFor(() => expect(editor.press).toHaveBeenCalled());
    await screen.findByRole("dialog");

    act(() => {
      screen.getByRole("button", { name: "Next" }).click();
    });

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(editor.cancelled).toHaveBeenCalledTimes(1);
    expect(editor.cancelled.mock.invocationCallOrder[0]).toBeLessThan(
      push.mock.invocationCallOrder[0],
    );
  });

  it("leaves alone a control that says it cannot be put back", async () => {
    // Edit says so when the page holds a draft of the reader's, which
    // Cancel would throw away.
    const editor = plantEditor();
    const edit = document.querySelector('[data-tour="page-edit"]') as HTMLElement;
    edit.setAttribute("data-tour-undo", "");
    onThePage();

    render(<TourRunner />);

    // The hint, which is what the step falls back to when its control
    // cannot be reached for it.
    await screen.findByText(/Choose Edit/);
    expect(editor.press).not.toHaveBeenCalled();
  });

  it("keeps the editor open across the run of steps that are about it", async () => {
    // Four steps in a row are about the editor. Shutting it after each one
    // flickered the page, had it write and discard a draft four times, and
    // left the step arriving looking for its control on a half-shut page.
    const editor = plantEditor();
    pathname = "/projects/example-project/tome/wiki/charter.md";
    window.sessionStorage.setItem(
      TOUR_STATE_KEY,
      JSON.stringify({
        tour: "editing",
        index: EDITING_TOUR.findIndex((step) => step.id === "modes"),
        subject: { slug: "example-project", pagePath: "charter.md" },
      }),
    );

    render(<TourRunner />);
    await waitFor(() => expect(editor.press).toHaveBeenCalledTimes(1));
    await screen.findByRole("dialog");

    act(() => {
      screen.getByRole("button", { name: "Next" }).click();
    });
    await screen.findByText("Telling the agent what a dynamic page should say");

    expect(editor.cancelled).not.toHaveBeenCalled();
    expect(editor.press).toHaveBeenCalledTimes(1);

    // And it is still given back at the end.
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await waitFor(() => expect(editor.cancelled).toHaveBeenCalledTimes(1));
  });

  it("does not press a menu that has already shut itself", async () => {
    // A menu closes when the reader clicks anywhere else, and pressing Next
    // is clicking somewhere else. The press meant to close it opened it
    // again, and the step after this one was read through a menu.
    const presses: boolean[] = [];
    const notify = plant(
      "page-notify",
      { top: 60, left: 800, width: 127, height: 28 },
      "button",
    );
    notify.setAttribute("aria-expanded", "false");
    notify.addEventListener("click", () => {
      const open = notify.getAttribute("aria-expanded") === "true";
      presses.push(!open);
      notify.setAttribute("aria-expanded", String(!open));
    });
    plant("page-cancel", { top: 60, left: 950, width: 60, height: 28 }, "button");
    onThePage();

    render(<TourRunner />);
    await waitFor(() => expect(presses).toEqual([true]));

    // The reader's click elsewhere, which the menu sees for itself.
    act(() => {
      notify.setAttribute("aria-expanded", "false");
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(presses).toEqual([true]);
  });

  it("does not undo what the reader opened themselves", async () => {
    // Already editing: Edit is gone and the menu it reveals is here. The
    // step opens the menu and gives back only that.
    const cancelled = jest.fn();
    const cancel = plant(
      "page-cancel",
      { top: 60, left: 950, width: 60, height: 28 },
      "button",
    );
    cancel.addEventListener("click", cancelled);
    const notify = plant(
      "page-notify",
      { top: 60, left: 800, width: 127, height: 28 },
      "button",
    );
    const opened = jest.fn();
    notify.addEventListener("click", opened);
    onThePage();

    render(<TourRunner />);
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    await waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe("a page the lookup could not find", () => {
  it("is waited for rather than navigated to anyway", async () => {
    // Started from inside a project, both because that is where a reader
    // would be and because what the lookup found is remembered against it.
    pathname = "/projects/example-caller-a/tome";
    // A lookup still in flight. The first step of the tour about writing a
    // page has a route it cannot work out yet, which is a reason to wait —
    // never a reason to navigate to whatever that comes out as.
    global.fetch = jest.fn(
      () => new Promise(() => {}),
    ) as unknown as typeof fetch;

    render(<TourRunner />);
    act(() => {
      startTour("editing");
    });

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(/Finding a project/),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("is looked for past the first handful of projects", async () => {
    // A deployment whose first few projects are empty still has a page to
    // borrow, and a single batch of probes used to decide it did not.
    pathname = "/projects/example-caller-b/tome";
    const slugs = Array.from({ length: 9 }, (_, index) => `project-${index}`);
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("/api/notifications/following")
        ? { data: { nodes: [] } }
        : url.includes("/api/projects")
          ? { data: { projects: slugs.map((slug) => ({ slug })) } }
          : {
              data: {
                pages: url.includes("project-8") ? { "charter.md": "" } : {},
              },
            };
      return { ok: true, json: async () => payload };
    }) as unknown as typeof fetch;

    render(<TourRunner />);
    act(() => {
      startTour("editing");
    });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/projects/project-8/tome/wiki/charter.md",
      ),
    );
  });
});

describe("the projects the reader watches", () => {
  it("are the ones they watch, not everything they were offered", async () => {
    // The endpoint lists the whole tree with a flag on each row. Reading it
    // as a list of followed projects put an unwatched one first.
    pathname = "/projects/example-caller-c/tome";
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("/api/notifications/following")
        ? {
            data: {
              nodes: [
                { type: "project", slug: "example-other", following: false },
                { type: "project", slug: "example-watched", following: true },
              ],
            },
          }
        : url.includes("/api/projects")
          ? { data: { projects: [{ slug: "example-other" }] } }
          : {
              data: {
                pages: url.includes("example-caller-c")
                  ? {}
                  : { "charter.md": "" },
              },
            };
      return { ok: true, json: async () => payload };
    }) as unknown as typeof fetch;

    render(<TourRunner />);
    act(() => {
      startTour("editing");
    });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/projects/example-watched/tome/wiki/charter.md",
      ),
    );
  });
});

describe("a card for a control that never moves", () => {
  it("is placed on arrival rather than at the first thing that stirs", async () => {
    // The card is positioned from a measurement taken once the popover has
    // rendered. Taking it before meant the card stayed hidden until the
    // ring happened to move, which on a static control is never.
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

    const card = await screen.findByRole("dialog");
    const panel = card.closest("[data-popover-content]") as HTMLElement;
    await waitFor(() => expect(panel.style.visibility).toBe("visible"));
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
