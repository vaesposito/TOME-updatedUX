"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { findTour } from "@/components/tour/tour-catalog";
import {
  projectSlugFromPath,
  requestedTourId,
  samePath,
  TOUR_START_EVENT,
  TOUR_STATE_KEY,
  type TourAnchor,
  type TourSubject,
} from "@/components/tour/tour";

/**
 * Runs a walkthrough.
 *
 * Mounted once for the whole app, because a tour crosses routes: it is the
 * only part that survives a step moving from the notification page to a
 * project, and it reads its place back out of session storage after each
 * navigation.
 *
 * Nothing is blocked while it runs. The highlight is drawn with a ring and a
 * very wide shadow that dims the rest of the window, both of which ignore the
 * pointer — so a reader can click the control being explained, which is the
 * whole point of pointing at the real one.
 */

/** How often the anchor is re-measured, for elements that have yet to appear. */
const POLL_MS = 100;

/**
 * How long an arrived step is given to find its anchor before giving up.
 *
 * A page that has just been navigated to renders in pieces, and the control a
 * step is about is rarely in the first piece. Falling back to an unanchored
 * card the instant it is missing would make every navigation flash one.
 *
 * Long enough to cover that, and no longer: nothing at all is drawn while a
 * step is waiting, so every extra second here is a second of blank page
 * after the reader has asked for a tour.
 */
const GRACE_MS = 1200;

/** A navigation that never lands must not strand the reader on one step. */
const NAVIGATION_TIMEOUT_MS = 6000;

/**
 * How long the ring keeps re-reading after a step has scrolled to its anchor.
 *
 * `scrollIntoView` is asynchronous and smooth, so the box it was asked about
 * keeps moving after the call returns. Leaving that to the poll drew the ring
 * beside the control for a tenth of a second and then stepped it on, which is
 * the one moment a reader is looking straight at it.
 */
const SETTLE_MS = 1000;

/**
 * How many times a step will scroll for the same anchor.
 *
 * More than once because a page still filling in moves what the step is
 * reaching for, and few because each attempt waits out a settle: a reader
 * should be looking at the control within a moment of arriving, not watching
 * the page hunt for it.
 */
const SCROLL_TRIES = 3;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  );
}

/**
 * How much of the window a spotlight may cover before it is cut down.
 *
 * Some anchors are whole panels rather than controls — a project's Home, a
 * view behind a tab. A ring drawn around one of those runs off the bottom of
 * the window, leaves the card nowhere to sit, and tells the reader nothing,
 * since everything they can see is inside it. Past this much, the ring is
 * put around the top of the region instead: the heading they would read
 * first, with the rest of it in plain view below.
 */
const TALL_ANCHOR_RATIO = 0.8;

/** The band of a too-tall region that gets ringed. */
const TALL_ANCHOR_BAND = 0.35;

/** Whether this region is too tall to ring whole. See TALL_ANCHOR_RATIO. */
function isTall(height: number): boolean {
  return height > window.innerHeight * TALL_ANCHOR_RATIO;
}

/**
 * The element a step is about, preferring one the reader can see.
 *
 * An anchor can match more than once: the same control is offered both in a
 * project's header and in its settings, and a tab's panel is in the document
 * before it is opened. Taking the first match in document order handed back
 * the invisible copy and rang a control nobody could see.
 */
function anchorNode(anchor: string): Element | null {
  const matches = Array.from(document.querySelectorAll(`[data-tour="${anchor}"]`));
  // A node that is present but collapsed is not something to point at — a
  // tab panel that has not opened yet, say.
  const drawn = matches.filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  });
  // On screen wins over merely drawn, but a single anchor that is simply
  // scrolled away still counts: it is about to be scrolled to.
  const onScreen = drawn.find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.top + rect.height > 0 && rect.top < window.innerHeight;
  });
  return onScreen ?? drawn.at(0) ?? null;
}

/**
 * A control the runner may press, or null if it cannot press it yet.
 *
 * Disabled is not "not yet": a page the reader may not edit, or a menu held
 * while a save is in flight, is a control the step has to wait for or do
 * without, and pressing it would do nothing anyway.
 */
function openable(anchor: string): HTMLElement | null {
  const node = anchorNode(anchor);
  if (!(node instanceof HTMLElement)) return null;
  if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true") {
    return null;
  }
  // An empty `data-tour-undo` is a control saying it cannot be put back as
  // things stand. Edit says it when the page has a draft of the reader's,
  // which Cancel would throw away. See `TourStep.opens`.
  if (node.getAttribute("data-tour-undo") === "") return null;
  return node;
}

/** Whether a control says it is already showing what it opens. */
function isOpen(node: HTMLElement): boolean {
  return (
    node.getAttribute("aria-expanded") === "true" ||
    node.getAttribute("aria-selected") === "true" ||
    node.getAttribute("aria-pressed") === "true"
  );
}

/** A control this tour pressed, and what it would take to give it back. */
interface Held {
  /** What was pressed, so a step that wants the same thing can keep it. */
  anchor: string;
  /** The page it was pressed on. A hold does not survive leaving it. */
  where: string;
  undo: () => void;
}

/**
 * How to put a control back, decided before it is pressed.
 *
 * Pressing a button twice shuts what it opened, but pressing a tab twice
 * only chooses it again — so a step that opened Following would hand the
 * reader back a page they had not asked to be on. And some controls have no
 * second press at all: Edit is replaced by the cluster that ends the edit,
 * so it names Cancel in `data-tour-undo` instead.
 *
 * A function rather than an element, because what undoes a control may not
 * be on the page until it has been pressed.
 */
function undoFor(anchor: string, node: HTMLElement): () => void {
  const named = node.getAttribute("data-tour-undo");
  if (named) return () => pressWhenReady(named);
  const list = node.closest('[role="tablist"]');
  const chosen = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (chosen && chosen !== node) {
    return () => {
      if (chosen.isConnected) press(chosen);
    };
  }
  // Found again rather than kept. A page that re-renders while the step is
  // being read — the editor does, every time it saves its draft — can hand
  // back a different element for the same control, and pressing the one we
  // pressed before would be pressing something no longer on the page.
  return () => {
    const again = anchorNode(anchor) ?? (node.isConnected ? node : null);
    if (!(again instanceof HTMLElement)) return;
    // Shut already. A menu closes itself when the reader clicks anywhere
    // else, and pressing Next is clicking somewhere else — so the press
    // meant to close it would have opened it again. Only a control that
    // says nothing about itself is pressed on trust.
    if (again.getAttribute("aria-expanded") === "false") return;
    press(again);
  };
}

/**
 * How long an undo waits for the control that performs it to turn up.
 *
 * Opening the editor is a round trip, so a reader who presses Escape in the
 * second after a step opened it was leaving before Cancel existed: nothing
 * was pressed, the editor arrived anyway, and the page was left being
 * edited. Longer than that round trip, and bounded so a page that never
 * comes back does not leave something waiting for it forever.
 */
const UNDO_WAIT_MS = 3000;

/** Press a control now, or as soon as it exists. See UNDO_WAIT_MS. */
function pressWhenReady(anchor: string): void {
  const now = openable(anchor);
  if (now) {
    press(now);
    return;
  }
  const deadline = Date.now() + UNDO_WAIT_MS;
  const timer = window.setInterval(() => {
    const later = openable(anchor);
    if (later) press(later);
    if (later || Date.now() > deadline) window.clearInterval(timer);
  }, POLL_MS);
}

/**
 * Press a control the way a mouse does, whatever it listens for.
 *
 * `click()` on its own is not a press. Radix's tabs and menus act on the
 * pointer going down and never see a bare click, so a step that opens one
 * would announce a control that never appeared. Our own popovers act on the
 * click and ignore the pointer.
 *
 * So: the pointer first, then a click only if the control did not already
 * answer it — otherwise anything listening to both would be opened and shut
 * again in a single press.
 */
function press(node: HTMLElement): void {
  const mouse = { bubbles: true, cancelable: true, button: 0 };
  if (typeof PointerEvent === "function") {
    node.dispatchEvent(new PointerEvent("pointerdown", { ...mouse, isPrimary: true }));
  }
  const before = isOpen(node);
  node.dispatchEvent(new MouseEvent("mousedown", mouse));
  node.dispatchEvent(new MouseEvent("mouseup", mouse));
  if (isOpen(node) === before) node.click();
}

/** Whether all of this box is already in the window. */
function inView(rect: DOMRect): boolean {
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.top + rect.height <= window.innerHeight &&
    rect.left + rect.width <= window.innerWidth
  );
}

/** Room left above a control brought to the top of its panel. */
const SCROLL_MARGIN = 12;

/**
 * The nearest thing the reader could scroll themselves, or null for the page.
 *
 * `scrollIntoView` moves every scrollable ancestor, and an `overflow: hidden`
 * box is scrollable to a script even though it has no scrollbar and ignores a
 * wheel. The application shell is one of those: a step that scrolled it left
 * the whole product sitting a hundred pixels up, under its own header, with
 * nothing the reader could do to put it back.
 */
function scroller(node: Element): Element | null {
  let parent = node.parentElement;
  while (parent) {
    const overflow = window.getComputedStyle(parent).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/** Bring a control into view, moving only what the reader could move. */
function scrollToAnchor(node: Element, block: "start" | "center"): void {
  const box = node.getBoundingClientRect();
  const container = scroller(node);
  const view = container?.getBoundingClientRect();
  const top = view?.top ?? 0;
  const height = view?.height ?? window.innerHeight;
  const by =
    block === "start"
      ? box.top - top - SCROLL_MARGIN
      : box.top - top - (height - box.height) / 2;
  (container ?? window).scrollBy({ top: by, behavior: "smooth" });
}

/**
 * The box the card has to keep clear of: the ring, and what the step opened.
 *
 * A step that opens a panel is explaining what is inside it, so a card put
 * under the control lands on top of the explanation. Measured rather than
 * assumed, since a menu may open below its control, above it, or to either
 * side — the bell's drops down and to the left, the agent's rises.
 *
 * Only panels touching the control count, so a tooltip somewhere else on the
 * page, or something the reader left open, does not drag the card across the
 * window.
 */
const PANEL_REACH = 24;

function clearOf(ring: Rect): Rect {
  let top = ring.top;
  let left = ring.left;
  let bottom = ring.top + ring.height;
  let right = ring.left + ring.width;
  const panels = document.querySelectorAll(
    "[data-popover-content],[data-radix-popper-content-wrapper]",
  );
  for (const panel of panels) {
    // The walkthrough's own card is drawn by the same popover, and a card
    // placed to clear itself would walk off the screen.
    if (panel.querySelector("[data-tour-card]")) continue;
    const box = panel.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const touching =
      box.left < right + PANEL_REACH &&
      box.left + box.width > left - PANEL_REACH &&
      box.top < bottom + PANEL_REACH &&
      box.top + box.height > top - PANEL_REACH;
    if (!touching) continue;
    top = Math.min(top, box.top);
    left = Math.min(left, box.left);
    bottom = Math.max(bottom, box.top + box.height);
    right = Math.max(right, box.left + box.width);
  }
  return { top, left, width: right - left, height: bottom - top };
}

function measure(anchor: TourAnchor): Rect | null {
  const node = anchorNode(anchor);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  if (!isTall(rect.height)) {
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  }
  // The band is taken from where the region is now rather than from its own
  // top. A reader who has scrolled into it, or a page that settled after the
  // step scrolled to it, would otherwise be given a ring above the window.
  const top = Math.max(rect.top, 0);
  return {
    top,
    left: rect.left,
    width: rect.width,
    height: Math.min(
      window.innerHeight * TALL_ANCHOR_BAND,
      rect.top + rect.height - top,
    ),
  };
}

/**
 * How many projects are asked for their pages at a time.
 *
 * In parallel rather than one after another: this runs while the reader is
 * on the first step, and sequential page listings were still going when they
 * reached the fourth.
 */
const PROBE_BATCH = 4;

/**
 * How many projects are asked at all before settling for one without pages.
 *
 * A cap rather than the whole catalogue: listing a project's pages is not a
 * free read, and the tour only needs one project that has any. It used to be
 * a single batch, which is why the tour about writing a page would not open
 * one — a deployment whose first four projects are empty has the tour
 * announce there is no page to borrow while holding a list full of them.
 */
const MAX_PROBES = 24;

/** The shallowest page in a project, or null if it has none. */
async function firstPage(slug: string): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/tome/projects/${encodeURIComponent(slug)}/pages`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    const body = await response.json();
    // Shallowest, then alphabetical: a tour should open something near the
    // top of the wiki rather than whatever the store happened to list first,
    // which differs between deployments.
    return (
      Object.keys(body?.data?.pages ?? {})
        .sort(
          (a, b) =>
            a.split("/").length - b.split("/").length || a.localeCompare(b),
        )
        .at(0) ?? null
    );
  } catch {
    return null;
  }
}

/** The projects the reader watches, which a tour prefers to borrow. */
async function followedSlugs(): Promise<string[]> {
  try {
    const response = await fetch("/api/notifications/following", {
      cache: "no-store",
    });
    if (!response.ok) return [];
    const body = await response.json();
    const nodes: Array<{ type?: string; slug?: string; following?: boolean }> =
      body?.data?.nodes ?? [];
    // The endpoint lists everything the reader could watch, each marked with
    // whether they do. Taking the lot made "the projects they watch" mean
    // "every project, alphabetically", which is not a preference at all.
    return nodes
      .filter((node) => node.type === "project" && node.following && node.slug)
      .map((node) => node.slug as string);
  } catch {
    return [];
  }
}

/** Every project the reader can open at all. */
async function readableSlugs(): Promise<string[]> {
  try {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) return [];
    const body = await response.json();
    const projects: Array<{ slug?: string }> = body?.data?.projects ?? [];
    return projects.filter((project) => project.slug).map((p) => p.slug as string);
  } catch {
    return [];
  }
}

/**
 * The project the project-bound steps borrow, and a page inside it.
 *
 * From the reader's own readable set rather than a fixture, so the tour works
 * in any deployment and never points at something they would get a 403 from.
 *
 * One project for all of them, and preferably one with a page in it: a
 * walkthrough that hopped between projects between steps would read as
 * unrelated screenshots, and the first project someone can see is quite
 * often an empty one.
 *
 * Three sources, in the order a reader would expect: the project they are
 * standing in, then the ones they watch, then anything they can read at all.
 * Watching alone was not enough — someone on their first day watches nothing,
 * and every step about a page told them there was no page to show, in a
 * deployment full of them.
 */
async function lookUpSubject(preferred: string | null): Promise<TourSubject> {
  // Both at once: they are independent, and asking one after the other put
  // two round trips in front of the first step of three of the tours.
  const [followed, readable] = await Promise.all([
    followedSlugs(),
    readableSlugs(),
  ]);
  const slugs = [
    ...new Set([...(preferred ? [preferred] : []), ...followed, ...readable]),
  ];

  // A batch at a time, stopping at the first project with a page in it: the
  // usual answer is in the first batch, and a deployment where it is not
  // should still get a page rather than an apology. See MAX_PROBES.
  const candidates = slugs.slice(0, MAX_PROBES);
  for (let from = 0; from < candidates.length; from += PROBE_BATCH) {
    const batch = candidates.slice(from, from + PROBE_BATCH);
    const pages = await Promise.all(batch.map(firstPage));
    const found = pages.findIndex((path) => path !== null);
    if (found >= 0) {
      return {
        slug: batch[found] as string,
        pagePath: pages[found] as string,
      };
    }
  }
  // Nothing with a page: the first readable project still serves the steps
  // that only need a project, and the page steps say what is missing.
  return { slug: slugs.at(0) ?? null, pagePath: null };
}

/**
 * What the lookup found, kept for the rest of the session.
 *
 * Six requests to learn which project to borrow is a price worth paying once.
 * Paying it again on the second tour — and on a tour restarted because the
 * reader wanted another look — is what made them feel slow. Keyed by the
 * project the reader was standing in, since that is what changes the answer.
 */
const subjects = new Map<string, TourSubject>();
const inFlight = new Map<string, Promise<TourSubject>>();

function resolveSubject(preferred: string | null): Promise<TourSubject> {
  const key = preferred ?? "";
  const known = subjects.get(key);
  if (known) return Promise.resolve(known);
  const running = inFlight.get(key);
  if (running) return running;
  const promise = lookUpSubject(preferred)
    .then((subject) => {
      // A lookup that found nothing is not remembered: the reader may have
      // been given a project since, and the next tour should check.
      if (subject.slug) subjects.set(key, subject);
      return subject;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * Start the lookup before a tour is chosen.
 *
 * Called when the chooser opens: reading five names and deciding takes a
 * second or two, which is about what the lookup needs, so by the time one is
 * picked its first step can go straight to the page it is about.
 */
export function prefetchTourSubject(): void {
  if (typeof window === "undefined") return;
  void resolveSubject(projectSlugFromPath(window.location.pathname));
}

interface Saved {
  /** Which of the catalogue's tours this place belongs to. */
  tour: string;
  index: number;
  /**
   * Null until the lookup finishes.
   *
   * The tour opens on the first step before knowing which project the last
   * three will borrow, because the bell is in the header of the page the
   * reader is already on. Waiting for the lookup first meant a button that
   * did nothing for as long as it took.
   */
  subject: TourSubject | null;
  /**
   * The step being reached for, if the reader asked for one and it has not
   * been shown yet.
   *
   * Saved because reaching a step can mean a fresh page load — see the effect
   * that writes this — and a request lost in that moment reads as a Next that
   * did nothing.
   */
  pending?: number | null;
}

function readSaved(): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(TOUR_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Saved;
    if (typeof parsed?.index !== "number") return null;
    const tour = findTour(parsed.tour);
    if (!tour) return null;
    if (parsed.index < 0 || parsed.index >= tour.steps.length) return null;
    const asked = parsed.pending;
    const wanted =
      typeof asked === "number" && asked >= 0 && asked < tour.steps.length
        ? asked
        : null;
    return { ...parsed, pending: wanted };
  } catch {
    // Storage can be unavailable or hold something stale; either way the
    // tour simply is not running.
    return null;
  }
}

export function TourRunner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /** Where the reader is, query and all, as a step's route is written. */
  const location = React.useMemo(() => {
    const query = searchParams?.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const [state, setState] = React.useState<Saved | null>(null);
  /**
   * A step asked for but not yet shown, because its page is still arriving.
   *
   * The reader keeps looking at the step they are on until the destination is
   * there. Advancing first meant the card left its anchor, sat in the middle
   * of the window describing a control on a page that had not loaded, and
   * then jumped again — three moves to change one step.
   */
  const [pending, setPending] = React.useState<number | null>(null);
  /**
   * The last place an anchor was found, kept rather than cleared.
   *
   * So that the card has somewhere to be during the moment between one page
   * going and the next one's controls appearing. It is faded out over that
   * moment, so where it is matters less than that it does not move.
   */
  const [rect, setRect] = React.useState<Rect | null>(null);
  /**
   * Where the card hangs from: the ring, grown to take in whatever the step
   * opened, so the card sits clear of it rather than over it.
   */
  const [avoid, setAvoid] = React.useState<Rect | null>(null);
  /** Whether the current step's anchor is on the page right now. */
  const [found, setFound] = React.useState(false);
  /** True while the step's own anchor is absent and the hint is showing. */
  const [waiting, setWaiting] = React.useState(false);
  /** Set once a step has had long enough to find an anchor. See GRACE_MS. */
  const [graceOver, setGraceOver] = React.useState(false);

  /** The tour being walked, and the step within it. */
  const tour = findTour(state?.tour);
  // Memoised because an empty array literal is a new array every render, and
  // the route lookup below is keyed on it.
  const steps = React.useMemo(() => tour?.steps ?? [], [tour]);
  const step = state ? steps[state.index] : undefined;

  // Resume after a navigation, and listen for a request to start one.
  React.useEffect(() => {
    const saved = readSaved();
    setState(saved);
    // The step that was being reached for is picked up again, so a Next that
    // crossed pages by way of a page load finishes rather than coming back on
    // the step it left.
    setPending(saved?.pending ?? null);

    const onStart = (event: Event) => {
      // A tour we do not have is not started at all, rather than started as
      // whichever one happens to be first.
      const asked = findTour(requestedTourId(event));
      if (!asked) return;
      setState({ tour: asked.id, index: 0, subject: null });
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, []);

  /** The project the reader is standing in, if they started from one. */
  const here = React.useMemo(() => projectSlugFromPath(pathname), [pathname]);

  // Find the project the project-bound steps borrow, in the background. Also
  // covers resuming after a reload, which restores the place but not the
  // lookup.
  const looking = React.useRef(false);
  React.useEffect(() => {
    if (!state || state.subject || looking.current) return;
    looking.current = true;
    const look = async () => {
      const subject = await resolveSubject(here);
      setState((current) => (current ? { ...current, subject } : current));
      looking.current = false;
    };
    void look();
    // `here` is read once per lookup rather than watched: a tour that is
    // already walking has its subject, and re-running this as it navigates
    // into that subject would be chasing its own tail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const stop = React.useCallback(() => {
    setState(null);
    setRect(null);
    setAvoid(null);
    try {
      window.sessionStorage.removeItem(TOUR_STATE_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }, []);

  /** Show a step. Only called once its page is on screen. */
  const go = React.useCallback((index: number) => {
    setPending(null);
    // Storing the new place is left to the effect below, which watches both
    // the place and the request: two writers disagreed about whether a step
    // already reached was still being asked for.
    setState((current) => (current ? { ...current, index } : current));
  }, []);

  /** Ask for a step. What Back and Next do; the arriving is `go`'s job. */
  const request = React.useCallback((index: number) => setPending(index), []);

  /**
   * What this tour has opened and not yet given back.
   *
   * Held out here rather than inside the effect that fills it, because the
   * one moment it must not be missed is a step that leaves by navigating:
   * by the time a route change reaches an effect, the page that held the
   * Cancel button has gone, and with it the chance to press it.
   */
  const held = React.useRef<Held[]>([]);
  /**
   * Give back what the tour opened, bar anything the next step wants too.
   *
   * Four steps in a row are about the editor, and shutting it between each
   * one would flicker the page and have it write and throw away a draft
   * four times over. Worse, the step arriving looks for its control while
   * the one leaving is still closing, and finds the half-shut page.
   *
   * Only what was opened here is put back. A hold left on a page the reader
   * has since left is dropped: there is nothing there to press, and the
   * page discards its own untouched draft as it goes.
   */
  const putBack = React.useCallback(
    (keep: readonly string[] = []) => {
      const holds = held.current;
      held.current = holds.filter((h) => h.where === location && keep.includes(h.anchor));
      for (const hold of [...holds].reverse()) {
        if (hold.where === location && !held.current.includes(hold)) hold.undo();
      }
    },
    [location],
  );

  // Persist the place, and the step being reached for along with it.
  //
  // Covers the opening step, which `go` never sees — and the case that broke
  // tours wherever pages are served as directories: the step asks for a page
  // written without a trailing slash, the host answers with one, and the
  // redirect is a fresh page load. Everything in React goes with it, so a
  // request held only in state was lost, the tour came back on the step it
  // had left, and that step's own route sent the reader back where they
  // started. Pressing Next did nothing, forever.
  React.useEffect(() => {
    if (!state) return;
    try {
      window.sessionStorage.setItem(
        TOUR_STATE_KEY,
        JSON.stringify({ ...state, pending }),
      );
    } catch {
      // The tour still runs; only resuming after a page load is lost.
    }
  }, [pending, state]);

  /**
   * Where a step belongs, or null if it cannot be worked out.
   *
   * An unresolved subject is asked as an empty one rather than skipped: most
   * steps ignore it, and treating "not looked up yet" as "nowhere to go"
   * held up the two inbox steps for a project they never needed.
   */
  const subjectProbe: TourSubject = React.useMemo(
    () => state?.subject ?? { slug: null, pagePath: null },
    [state?.subject],
  );
  const routeOf = React.useCallback(
    (index: number) => steps[index]?.route?.(subjectProbe) ?? null,
    [steps, subjectProbe],
  );

  /** The step the tour is trying to reach: the asked-for one, or the current. */
  const wantIndex = pending ?? state?.index ?? 0;
  const wantRoute = routeOf(wantIndex);
  /**
   * Whether the wanted step is waiting on the lookup rather than on a page.
   *
   * Its route came back empty only because the project it asks for is still
   * being found. Counting that as "nowhere to go, so we must be there
   * already" showed the step on whatever page the reader was on, then moved
   * it once the lookup landed — the tour appearing to open the wrong thing
   * and correct itself.
   */
  const unresolved =
    steps[wantIndex]?.route !== undefined &&
    wantRoute === null &&
    state?.subject === null;
  /** Whether the page the wanted step needs is the one on screen. */
  const arrived = !unresolved && (!wantRoute || samePath(wantRoute, location));
  /** The page the shown step was measured against has gone. */
  const shownRoute = state ? routeOf(state.index) : null;
  const stale = Boolean(shownRoute && !samePath(shownRoute, location));

  // Go where the wanted step lives, and show it only once there. Covers both
  // a Next that crosses pages and resuming on the wrong one after a reload.
  const pushed = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!state) return;
    if (arrived) {
      pushed.current = null;
      if (pending !== null) go(pending);
      return;
    }
    // Nowhere to go is a reason to wait or to say the step cannot be shown,
    // never a reason to go somewhere else: a page the lookup has not found
    // must not become the wiki's index.
    if (!wantRoute) return;
    if (pushed.current === wantRoute) return;
    pushed.current = wantRoute;
    // Before leaving, not after: the controls this step opened are on the
    // page we are about to replace.
    putBack();
    router.push(wantRoute);
  }, [arrived, go, pending, putBack, router, state, wantRoute]);

  // Never leave the reader on a step whose page refused to load.
  React.useEffect(() => {
    if (pending === null || arrived) return;
    const timer = window.setTimeout(() => {
      pushed.current = null;
      go(pending);
    }, NAVIGATION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [arrived, go, pending]);

  // Follow the anchor: it may not exist yet (a route still loading, or a
  // control that only appears once the page is being edited), and it moves
  // when the window scrolls.
  //
  // `rect` is only ever written when something was found. Clearing it the
  // moment an anchor goes is what used to throw the card into the middle of
  // the window between pages.
  //
  // Held in a ref as well, so the scroll below can re-read the box as it
  // comes to rest rather than leaving it to the next poll.
  const resync = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    if (!step) return;

    const sync = () => {
      const own = step.anchor ? measure(step.anchor) : null;
      const next =
        own ?? (step.waitingAnchor ? measure(step.waitingAnchor) : null);
      setWaiting(!own);
      setFound(next !== null);
      if (!next) return;
      setRect((current) => (sameRect(current, next) ? current : next));
      const clear = step.opens?.length ? clearOf(next) : next;
      setAvoid((current) => (sameRect(current, clear) ? current : clear));
    };

    resync.current = sync;
    sync();
    const timer = window.setInterval(sync, POLL_MS);
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [pathname, step]);

  // Give each step on each page its own grace period before admitting it has
  // nothing to point at, so a slow-rendering page does not flash a homeless
  // card on the way in.
  React.useEffect(() => {
    setGraceOver(false);
    const timer = window.setTimeout(() => setGraceOver(true), GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, step]);

  // Bring the anchor into view when it first turns up, not on a timer: on a
  // page that was still loading the timer fired at nothing and never tried
  // again. Once per step, because scrolling someone's page under them while
  // they are reading is its own kind of rude.
  const scrolled = React.useRef<string | null>(null);
  React.useEffect(() => {
    // `found` counts a step's waiting anchor as well as its own, and waiting
    // is where most steps begin: a page still arriving, or a control the
    // editor has not put there yet. Starting on that spent the one scroll a
    // step gets on a control that was not on the page, and every later look
    // was turned away as already done — the step then sat at the top of the
    // page with the thing it is about below the fold.
    if (!step?.anchor || !found || waiting || stale) return;
    const anchor = step.anchor;
    // Keyed by where as well as what: step ids repeat between tours, and a
    // reader taking a second tour found its shared steps never scrolled.
    const key = `${state?.tour}:${step.id}:${location}`;
    if (scrolled.current === key) return;
    // Claimed only once there is something to scroll to. The anchor was there
    // when the poll last looked, a moment ago, but a page still filling in
    // drops it between renders and the scroll is no use without it.
    if (!anchorNode(anchor)) return;
    scrolled.current = key;
    let frame = 0;

    /**
     * Scroll to the anchor, then make sure it really arrived.
     *
     * A page that is still filling in grows under the scroll: settings asks
     * for the spaces it lists, and the list it is asked to reach sits a
     * screen further down by the time the answer lands, leaving a scroll made
     * a moment earlier short of it. So the box is read again once the scroll
     * has come to rest, and the whole thing repeated while the anchor is
     * still out of sight — a few times at most, because the alternative is
     * chasing a page that never settles.
     */
    const reach = (attempt: number) => {
      const node = anchorNode(anchor);
      if (!node) return;
      const box = node.getBoundingClientRect();
      // A control already in front of the reader is left where it is.
      // `scrollIntoView` moves every scrollable ancestor to obey `block`, so
      // asking it to centre something that was already in view pulled the
      // page out from under whoever had just arrived on it.
      if (inView(box)) return;
      if (attempt > SCROLL_TRIES) return;
      // Centring a region taller than the window scrolls past its beginning:
      // the reader is put half way down a panel they have not seen the top
      // of. Those are brought to the top instead, where their heading is.
      scrollToAnchor(node, isTall(box.height) ? "start" : "center");

      // Then follow it to its rest. A smooth scroll stops firing `scroll`
      // before its last frame is painted, so the box is re-read until it
      // repeats or the scroll has had long enough. See SETTLE_MS.
      let previous: string | null = null;
      const deadline = Date.now() + SETTLE_MS;
      const settle = () => {
        resync.current();
        const rect = node.getBoundingClientRect();
        const where = `${rect.top},${rect.left}`;
        if (where === previous || Date.now() > deadline) {
          reach(attempt + 1);
          return;
        }
        previous = where;
        frame = window.requestAnimationFrame(settle);
      };
      frame = window.requestAnimationFrame(settle);
    };

    reach(1);
    return () => window.cancelAnimationFrame(frame);
  }, [found, location, stale, state?.tour, step, waiting]);

  /**
   * Open what the step is about, and close it again on the way out.
   *
   * A step whose subject is behind a button used to ring the shut button and
   * tell the reader to press it, which is a poor way to show someone what a
   * thing is. The controls are named by the step rather than by this effect,
   * so a tour is still only data. See `TourStep.opens`.
   *
   * On a timer rather than once, because the control a step opens may arrive
   * long after the step does: the Notifications menu exists only once the
   * reader has chosen Edit, which they are asked to do and may take a while
   * over.
   */
  React.useEffect(() => {
    const opens = step?.opens;
    if (stale) return;
    // What the step before opened and this one does not want. Done here
    // rather than in that step's cleanup, because only the step arriving
    // knows what is worth keeping open.
    putBack(opens ?? []);
    if (!opens?.length) return;
    let next = 0;
    const openNext = () => {
      while (next < opens.length) {
        const anchor = opens[next];
        // Kept open from the step before. Nothing to press, and nothing to
        // record: it is already down as ours to give back.
        if (held.current.some((hold) => hold.anchor === anchor)) {
          next += 1;
          continue;
        }
        const node = openable(anchor);
        if (node) {
          // Already showing what it opens — the reader got there first, and
          // pressing it now would shut the thing the step is about.
          if (!isOpen(node)) {
            held.current.push({ anchor, where: location, undo: undoFor(anchor, node) });
            press(node);
          }
          next += 1;
          return;
        }
        // Not there. If something further along the chain is, this one has
        // already done its job — the reader pressed Edit themselves, and the
        // button that would do it is gone. Carry on from what is there, and
        // leave it out of the undoing: we did not open it.
        const ahead = opens.slice(next + 1).findIndex((later) => openable(later));
        if (ahead < 0) return;
        next += 1 + ahead;
      }
    };
    openNext();
    const timer = window.setInterval(openNext, POLL_MS);
    return () => window.clearInterval(timer);
  }, [location, putBack, stale, step]);

  // The end of the tour, by Done or by Escape or by the reader closing the
  // card: everything still open goes back. A step leaving for another page
  // has already given its own back, before the page it was on went.
  React.useEffect(() => {
    if (state) return;
    putBack();
  }, [putBack, state]);

  // And if the runner itself goes.
  const leaving = React.useRef(putBack);
  React.useEffect(() => {
    leaving.current = putBack;
  }, [putBack]);
  React.useEffect(() => () => leaving.current(), []);

  React.useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state, stop]);

  if (!state || !step) return null;

  const last = state.index === steps.length - 1;
  /** This step wants something of the reader's that could not be supplied. */
  const unsupplied = step.route !== undefined && routeOf(state.index) === null;
  /** Still being looked up, as against looked up and not there. */
  const searching = unsupplied && state.subject === null;
  const unreachable = unsupplied && state.subject !== null;
  /** A page has been asked for and has not arrived. */
  const navigating = (pending !== null && !arrived) || searching;
  /**
   * Faded out: either the page this was measured against has gone, or the
   * next one's controls have yet to appear. One fade out and one fade in per
   * page, rather than the card moving three times to change one step.
   */
  const dimmed = stale || !found;
  const body = searching
    ? "Finding a project to show you…"
    : unreachable
      ? (step.unavailable ?? step.body)
      : waiting && step.hint
        ? step.hint
        : step.body;

  const card = (
    <div
      role="dialog"
      aria-label={`${tour?.name ?? "TOME"} walkthrough`}
      data-tour-card=""
      className="w-80 space-y-3 p-4"
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Step {state.index + 1} of {steps.length}
      </p>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">{step.title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={stop}
        >
          Skip
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {state.index > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={navigating}
              onClick={() => request(state.index - 1)}
            >
              Back
            </Button>
          )}
          {/* Spins while the next step's page is on its way. The card itself
              does not move until it lands, so without this a step that
              crosses pages would look like a button that did nothing. */}
          <Button
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            disabled={navigating}
            onClick={() => (last ? stop() : request(state.index + 1))}
          >
            {navigating && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );

  /**
   * Nothing to point at, and no longer any reason to expect something.
   *
   * The step is still worth reading, so it is shown in the middle of the
   * window rather than silently skipped. Withheld until the grace period is
   * up and the page has settled, so arriving somewhere never flashes it.
   */
  // A step with no anchor is not waiting for one: it explains an idea
  // rather than a control, and is shown in the middle of the window at
  // once instead of after the grace period a missing anchor is given.
  const homeless =
    !step.anchor ||
    unreachable ||
    searching ||
    (!found && graceOver && !navigating && !stale);
  if (homeless) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
        {/* The same dimming an anchored step gets from its spotlight's very
            wide shadow. Without it a step with nothing to point at was a
            card floating over a fully lit page, which read as a stray
            dialog rather than as part of the walkthrough. Transparent to
            the pointer like the spotlight, so the page underneath still
            works — on a waiting step that is how the reader reveals what
            the step is about. */}
        <div
          aria-hidden="true"
          data-testid="tour-backdrop"
          className="absolute inset-0"
          style={{ background: "rgba(0, 0, 0, 0.6)" }}
        />
        <div className="pointer-events-auto relative rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          {card}
        </div>
      </div>
    );
  }

  // Still looking, with nowhere yet to have been. Lasts one poll at most.
  if (!rect) return null;
  const hang = avoid ?? rect;

  return (
    <Popover open onOpenChange={() => {}} className="fixed left-0 top-0 h-0 w-0">
      {/* The highlight. Fixed to the element's own box, and transparent to
          the pointer so the control underneath still works. The very wide
          shadow is what dims the rest of the window.

          Position changes are not animated: between pages the two boxes
          have nothing to do with each other, and a ring sliding across the
          window to a control on a different page read as a glitch. */}
      <span
        aria-hidden="true"
        data-testid="tour-spotlight"
        style={{
          position: "fixed",
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
          opacity: dimmed ? 0 : 1,
          pointerEvents: "none",
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
        }}
        className={cn(
          "z-[55] rounded-lg ring-2 ring-primary",
          !dimmed && "transition-opacity duration-200",
        )}
      />
      <PopoverTrigger asChild>
        {/* What the card hangs from, which is the ring plus anything the
            step opened. A separate node from the ring because the two want
            different boxes: the ring says "this control", the card only has
            to land somewhere that is not on top of it. */}
        <span
          aria-hidden="true"
          data-testid="tour-card-anchor"
          style={{
            position: "fixed",
            top: hang.top,
            left: hang.left,
            width: hang.width,
            height: hang.height,
            pointerEvents: "none",
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className={cn(
          "p-0",
          dimmed
            ? "pointer-events-none opacity-0"
            : "opacity-100 transition-opacity duration-200",
        )}
      >
        {card}
      </PopoverContent>
    </Popover>
  );
}
