import type { TourStep } from "@/components/tour/tour";

/**
 * The whole of TOME at a walking pace, pointing at the real controls.
 *
 * The order is the order someone meets the product: the catalogue first and
 * all four readings of it, then what a project holds once they open one, and
 * last the way to take any of it into a coding agent.
 *
 * The tabs are four steps rather than one about the tab bar, because each
 * answers a different question — what is there, who looks after it, what is
 * moving, what happened this week — and a reader shown only the bar has to
 * go and find that out for themselves.
 */
export const GENERAL_TOUR: readonly TourStep[] = [
  {
    id: "axes",
    anchor: "hub-tabs",
    route: () => "/projects",
    title: "Two ways to read the same organisation",
    body:
      "By project runs BHAG → Area → Project: the goals, and the work under them. By function runs Function → Category → Subject: the teams, and what they look after. A space sits on one axis or the other.",
  },
  {
    id: "search",
    anchor: "hub-search",
    route: () => "/projects",
    title: "Find a space without knowing where it sits",
    body:
      "Searches names and what each space is about, so you can get to one without walking the hierarchy down to it.",
  },
  {
    id: "create",
    anchor: "hub-create",
    route: () => "/projects",
    title: "Add a space and place it as you go",
    body:
      "The flow asks what you are making, where it belongs, and which sources it should read — GitHub repos, Confluence spaces, Webex rooms. A new space starts with one page the agent writes from those.",
  },
  {
    id: "functions",
    anchor: "hub-functions",
    route: () => "/projects?tab=functions",
    title: "The same organisation, read by function",
    body:
      "Functions hold categories, and categories hold subjects — the standing concerns a team owns, rather than the projects it is running. Subjects live on this axis and nowhere else.",
  },
  {
    id: "overview",
    anchor: "hub-overview",
    route: () => "/projects?tab=overview",
    title: "Overview is everything at a glance",
    body:
      "Every space as a card, with what is moving and what has gone quiet — for when you want the shape of the whole thing rather than one project in it.",
  },
  {
    id: "digest",
    anchor: "hub-digest",
    route: () => "/projects?tab=digest",
    title: "Digest is the week, written out",
    body:
      "The same activity as prose instead of cards: what shipped, what changed, and what is still open, so it can be read rather than scanned.",
  },
  {
    id: "home",
    anchor: "project-home",
    route: (subject) => (subject.slug ? `/projects/${subject.slug}/tome` : null),
    title: "A project opens on what has changed",
    body:
      "Home gathers what moved this week, what is waiting on someone, the decisions that are open, and where the knowledge came from — so you can tell the state of a project without reading all of it.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
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
