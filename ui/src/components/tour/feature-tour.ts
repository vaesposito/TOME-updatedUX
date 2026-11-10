import { TOUR_STATE_KEYS, type TourStep } from "@/components/tour/tour";

/**
 * A tour of what TOME does, pointing at the real controls.
 *
 * The order is the order someone meets the product: the catalogue first —
 * how it is organised, how to search it, how to add to it — then what a
 * project holds once they open one, and last the way to take any of it into
 * a coding agent.
 *
 * Every step is anchored to something that exists. There is no step for a
 * feature we could only describe, because a card floating in the middle of
 * the window saying "there is also a glossary" is a slideshow, and the
 * walkthrough dialog already does slideshows better.
 */
export const FEATURE_TOUR: readonly TourStep[] = [
  {
    id: "axes",
    anchor: "hub-tabs",
    route: () => "/projects",
    title: "Two ways to read the same organisation",
    body:
      "By project runs BHAG → Area → Project: the goals and the work under them. By function runs Function → Category → Subject: the teams and what they look after. A space sits on one axis or the other. Overview and Digest are the same catalogue read shorter.",
  },
  {
    id: "search",
    anchor: "hub-search",
    route: () => "/projects",
    title: "Find a space without knowing where it sits",
    body:
      "Searches names and what each space is about, so you can get to one without walking the hierarchy to it.",
  },
  {
    id: "create",
    anchor: "hub-create",
    route: () => "/projects",
    title: "Add a space and place it as you go",
    body:
      "The flow asks what you are making, where it belongs, and which sources it should read — GitHub repos, Confluence spaces, Webex rooms. Ingest turns those into the wiki.",
  },
  {
    id: "home",
    anchor: "project-home",
    route: (subject) => (subject.slug ? `/projects/${subject.slug}/tome` : null),
    title: "A project opens on what has changed",
    body:
      "Home gathers what moved this week, what is waiting on someone, the decisions that are open, and where the knowledge came from — so you can tell the state of a project without reading it.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
  {
    id: "wiki",
    anchor: "page-edit",
    route: (subject) =>
      subject.slug && subject.pagePath
        ? `/projects/${subject.slug}/tome/wiki/${subject.pagePath
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`
        : null,
    title: "Pages are yours, or the agent's",
    body:
      "A page declares a kind. Stable pages are pinned by you and the agent leaves them alone; dynamic pages are rewritten on every ingest to stay current. Edit either one here — rich text, Markdown, or a preview.",
    unavailable:
      "This step needs a wiki page to open, and there is not one to borrow yet.",
  },
  {
    id: "mcp",
    anchor: "hub-mcp",
    route: () => "/projects",
    title: "Take all of it into your coding agent",
    body:
      "Connect over MCP and your agent can read the wiki, post to a project's activity, and update pages while you work — no copy-paste, and no second place to keep what it learns.",
  },
];

/** Dispatched on `window` to start this tour from anywhere. */
export const FEATURE_TOUR_START_EVENT = "grid.tour.features:start";

/** Where this tour keeps its place. See TOUR_STATE_KEYS. */
export const FEATURE_TOUR_STATE_KEY = TOUR_STATE_KEYS.features;
