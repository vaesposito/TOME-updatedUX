import type { TourStep } from "@/components/tour/tour";

const NO_PROJECT =
  "This step needs a project you can read, and there is not one yet.";

/**
 * The agent, and the Webex side of what it reads.
 *
 * Three places to ask it something — the floating panel, a project's own
 * box, and your editor over MCP — and then where the calls it listens to
 * are configured, which is the part people look for and do not find: it is
 * in a project's Settings rather than anywhere near the meetings it
 * produces.
 */
export const AGENT_TOUR: readonly TourStep[] = [
  {
    id: "ask",
    anchor: "ask-tome",
    route: () => "/projects",
    title: "Ask TOME from anywhere",
    body:
      "The panel follows you around the application. It answers from the wikis you can read, across every space, rather than from whichever page you happen to be standing on.",
  },
  {
    id: "project-ask",
    anchor: "home-ask",
    route: (subject) => (subject.slug ? `/projects/${subject.slug}/tome` : null),
    title: "Or ask one project, on its own Home",
    body:
      "The same agent, narrowed to this space and what is tagged into it. Use it for the questions whose answer is in this project rather than in the organisation.",
    unavailable: NO_PROJECT,
  },
  {
    id: "webex",
    anchor: "webex-settings",
    route: (subject) =>
      subject.slug ? `/projects/${subject.slug}/tome/settings` : null,
    title: "Subscribe the space to a recurring call",
    body:
      "Webex configuration lives in Settings: attach a meeting series, and each call's transcript and summary are written up as pages after it ends. Rooms are attached as sources in the same place.",
    unavailable: NO_PROJECT,
  },
  {
    id: "mcp",
    anchor: "hub-mcp",
    route: () => "/projects",
    title: "Give your coding agent the same access",
    body:
      "Connect over MCP and Claude, Cursor or Claude Code can read these wikis, post to a project's activity and update pages while you work — the same knowledge, without leaving your editor.",
  },
];
