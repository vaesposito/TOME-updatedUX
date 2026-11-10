import { pageRoute } from "@/components/tour/editing-tour";
import type { TourStep } from "@/components/tour/tour";

/**
 * How one space's knowledge reaches another.
 *
 * Two mechanisms, and they are easy to confuse: connecting a page to a
 * space, which is a claim about where this page belongs, and an edge,
 * which is a typed relationship between two pages that the agent had to
 * find evidence for. The tour says which is which, and shows the first one
 * on the control that makes it.
 *
 * The opening and closing steps carry no anchor: what a connection is for,
 * and what the agent does with it, are ideas rather than buttons.
 */
export const LINKING_TOUR: readonly TourStep[] = [
  {
    id: "why",
    route: () => "/projects",
    title: "Nothing is only in one place",
    body:
      "A decision taken in one project is often the answer to a question asked in another. Rather than copying it, TOME connects the page to the other space: it shows up in that space's related content, and its agent can read it.",
  },
  {
    id: "connect",
    anchor: "page-tags",
    waitingAnchor: "page-edit",
    hint: "Choose Edit — Connect to a space sits with the page's own details.",
    route: pageRoute,
    title: "Connect a page to another space",
    body:
      "A whole-page connection is kept in the page's frontmatter, so it survives an ingest that rewrites the body. To connect a single paragraph instead, type # in the editor and pick the space.",
    unavailable:
      "This step needs a wiki page to open, and there is not one to borrow yet.",
  },
  {
    id: "related",
    anchor: "project-home",
    route: (subject) => (subject.slug ? `/projects/${subject.slug}/tome` : null),
    title: "The other end of the connection",
    body:
      "Every space has a Related content view listing the pages elsewhere that point at it, each saying whether the whole page or only a passage does. It is how a space sees what the rest of the organisation says about it.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
  {
    id: "edges",
    route: (subject) => (subject.slug ? `/projects/${subject.slug}/tome` : null),
    title: "Edges are the stronger claim",
    body:
      "An edge is a typed relationship between two pages — depends-on, blocks — and the agent cites what it read before drawing one. A connection says where a page belongs; an edge says how two pieces of work bear on each other.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
];
