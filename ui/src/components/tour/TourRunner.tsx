"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { findTour } from "@/components/tour/tour-catalog";
import {
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
 */
const GRACE_MS = 4000;

/** A navigation that never lands must not strand the reader on one step. */
const NAVIGATION_TIMEOUT_MS = 8000;

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

function measure(anchor: TourAnchor): Rect | null {
  const node = document.querySelector(`[data-tour="${anchor}"]`);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  // A node that is present but collapsed is not something to point at — a
  // tab panel that has not opened yet, say.
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: isTall(rect.height)
      ? window.innerHeight * TALL_ANCHOR_BAND
      : rect.height,
  };
}

/**
 * How many projects are asked for their pages before settling.
 *
 * A cap rather than the whole catalogue: listing a project's pages is not a
 * free read, and the tour only needs one project that has any.
 */
const MAX_PROBES = 4;

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
    const nodes: Array<{ type?: string; slug?: string }> =
      body?.data?.nodes ?? [];
    return nodes
      .filter((node) => node.type === "project" && node.slug)
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
async function resolveSubject(preferred: string | null): Promise<TourSubject> {
  const followed = await followedSlugs();
  const slugs = [
    ...new Set([
      ...(preferred ? [preferred] : []),
      ...followed,
      // Only when there is room left to probe: a reader who watches four
      // projects has given the tour all the subjects it can use.
      ...(followed.length < MAX_PROBES ? await readableSlugs() : []),
    ]),
  ];

  // Asked all at once rather than one after another: this runs while the
  // reader is on the first step, and four sequential page listings took long
  // enough to still be going when they reached the fourth.
  const candidates = slugs.slice(0, MAX_PROBES);
  const pages = await Promise.all(candidates.map(firstPage));
  const found = pages.findIndex((path) => path !== null);
  if (found >= 0) {
    return {
      slug: candidates[found] as string,
      pagePath: pages[found] as string,
    };
  }
  // Nothing with a page: the first readable project still serves the steps
  // that only need a project, and the page steps say what is missing.
  return { slug: slugs.at(0) ?? null, pagePath: null };
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
    return parsed;
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
    setState(readSaved());

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
  const here = React.useMemo(() => {
    const match = /^\/projects\/([^/]+)/.exec(pathname ?? "");
    const slug = match?.[1];
    // Not a project: `/projects/admin` is TOME's own settings page.
    return slug && slug !== "admin" ? decodeURIComponent(slug) : null;
  }, [pathname]);

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
    try {
      window.sessionStorage.removeItem(TOUR_STATE_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }, []);

  /** Show a step. Only called once its page is on screen. */
  const go = React.useCallback((index: number) => {
    setPending(null);
    setState((current) => {
      if (!current) return current;
      const next = { ...current, index };
      try {
        window.sessionStorage.setItem(TOUR_STATE_KEY, JSON.stringify(next));
      } catch {
        // The step still changes; only resuming after a reload is lost.
      }
      return next;
    });
  }, []);

  /** Ask for a step. What Back and Next do; the arriving is `go`'s job. */
  const request = React.useCallback((index: number) => setPending(index), []);

  // Persist the opening step, which `go` never sees.
  React.useEffect(() => {
    if (!state) return;
    try {
      window.sessionStorage.setItem(TOUR_STATE_KEY, JSON.stringify(state));
    } catch {
      // See `go`.
    }
  }, [state]);

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
  /** Whether the page the wanted step needs is the one on screen. */
  const arrived = !wantRoute || samePath(wantRoute, location);
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
    if (pushed.current === wantRoute) return;
    pushed.current = wantRoute;
    router.push(wantRoute as string);
  }, [arrived, go, pending, router, state, wantRoute]);

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
  React.useEffect(() => {
    if (!step) return;

    const sync = () => {
      const own = step.anchor ? measure(step.anchor) : null;
      const next =
        own ?? (step.waitingAnchor ? measure(step.waitingAnchor) : null);
      setWaiting(!own);
      setFound(next !== null);
      if (next) setRect((current) => (sameRect(current, next) ? current : next));
    };

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
    if (!step?.anchor || !found || stale) return;
    if (scrolled.current === step.id) return;
    scrolled.current = step.id;
    const node = document.querySelector(`[data-tour="${step.anchor}"]`);
    if (!node) return;
    // Centring a region taller than the window scrolls past its beginning:
    // the reader is put half way down a panel they have not seen the top of.
    // Those are brought to the top instead, where their heading is.
    node.scrollIntoView({
      block: isTall(node.getBoundingClientRect().height) ? "start" : "center",
      behavior: "smooth",
    });
  }, [found, stale, step]);

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

  return (
    <Popover open onOpenChange={() => {}} className="fixed left-0 top-0 h-0 w-0">
      <PopoverTrigger asChild>
        {/* The highlight itself, and the bubble's anchor. Fixed to the
            element's own box so one node does both jobs, and transparent to
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
