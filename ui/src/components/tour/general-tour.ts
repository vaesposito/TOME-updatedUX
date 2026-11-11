import type { TourStep } from "@/components/tour/tour";

/**
 * The whole of TOME at a walking pace, pointing at the real controls.
 *
 * It opens by saying what the reader is looking at, because most of them
 * arrive from something with far more on the screen and spend the first
 * minute looking for the rest of it. There is no rest of it, and saying so
 * is worth a step.
 *
 * The readings of the catalogue are anchored on their tabs rather than on
 * the panels they open: a panel is pages tall, and a spotlight drawn around
 * one rings far more than the window can hold while centring it scrolls
 * straight past the thing being named. The tab is where the reader would
 * click anyway, and the panel it opened is in plain view below it.
 *
 * The order is the order someone meets the product: the catalogue and the
 * two axes it can be read on, the two readings that summarise it, then what
 * a space holds once they open one, and last the way to take any of it into
 * a coding agent.
 *
 * There is no step on the search field. Finding a space by typing its name
 * is the one thing nobody has to be shown, and a tour earns its length by
 * leaving out what a reader would have found anyway.
 */
export const GENERAL_TOUR: readonly TourStep[] = [
  {
    id: "minimal",
    // Deliberately unanchored: it is about the screen as a whole, and a ring
    // drawn round any one part of it would be saying the opposite.
    route: () => "/projects",
    title: "Less on the screen than you are used to",
    body:
      "TOME is a smaller interface with fewer options than the tools it sits beside. What you can see is what there is: a catalogue of spaces, two ways to read it, and the pages each space holds. Nothing below is hidden behind a mode.",
  },
  {
    id: "projects",
    anchor: "hub-tab-projects",
    route: () => "/projects",
    title: "By project is the work, and the goals above it",
    body:
      "BHAG → Area → Project: the goals, and the work being done under them. This is the axis most spaces sit on, and the one the catalogue opens on.",
  },
  {
    id: "create",
    anchor: "hub-create",
    route: () => "/projects",
    title: "Add a space and place it as you go",
    body:
      "The flow asks what you are making, where it belongs, and which sources it should read — repositories, wiki spaces, meeting rooms. A new space starts with one page the agent writes from those.",
  },
  {
    id: "functions",
    anchor: "hub-tab-functions",
    route: () => "/projects?tab=functions",
    title: "The same organisation, read by function",
    body:
      "Function → Category → Subject: the teams, and what each of them looks after, rather than the projects any of them is running. A space sits on one axis or the other, never both.",
  },
  {
    id: "subject",
    // A subject is the function axis's own leaf rather than a tab of its
    // own, so the step is anchored on the one control that names it. Not
    // pressed: what it opens makes a space.
    anchor: "hub-add-subject",
    route: () => "/projects?tab=functions",
    title: "A subject is a standing concern, not a project",
    body:
      "It is its own space, and it lives on this axis and nowhere else — the thing a team owns year after year rather than the work it has in flight. Add subject makes one, and asks which function and category it belongs under.",
  },
  {
    id: "overview",
    anchor: "hub-tab-overview",
    route: () => "/projects?tab=overview",
    title: "Overview is everything at a glance",
    body:
      "Every space as a card, with what is moving and what has gone quiet — for when you want the shape of the whole thing rather than one project in it.",
  },
  {
    id: "digest",
    // The configuration rather than the prose: the digest itself is a page
    // tall, and the question a reader has here is who decides what is in it.
    anchor: "hub-digest-configure",
    route: () => "/projects?tab=digest",
    title: "Digest is the week, written out",
    body:
      "The same activity as prose instead of cards: what shipped, what changed, and what is still open, so it can be read rather than scanned. Configure digest sets what it covers and how often it is written.",
  },
  {
    id: "home",
    anchor: "project-home",
    route: (subject) => (subject.slug ? `/projects/${subject.slug}/tome` : null),
    title: "A space opens on what has changed",
    body:
      "Home gathers what moved this week, what is waiting on someone, the decisions that are open, and where the knowledge came from — so you can tell the state of a space without reading all of it.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
  {
    id: "mcp",
    anchor: "hub-mcp",
    route: () => "/projects",
    title: "Take all of it into your coding agent",
    body:
      "Connect over MCP and your agent can read the wiki, post to a space's activity, and update pages while you work — no copy-paste, and no second place to keep what it learns.",
  },
];
