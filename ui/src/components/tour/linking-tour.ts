import { wikiPageRoute, type TourStep } from "@/components/tour/tour";

const NO_PAGE =
  "This step needs a wiki page to open, and there is not one to borrow yet.";

const NO_SECOND_SPACE =
  "This step needs a second space you can read, and there is only one.";

/**
 * One page, two spaces, and the walk between them.
 *
 * The thing a reader has to see here is that a connection has a far end:
 * the page is written in one space and turns up in another, without being
 * copied and without anyone over there doing anything. A step that stayed
 * in the space the page lives in could say that, but it could not show it,
 * so the tour crosses to the second space the subject carries and finishes
 * there.
 *
 * It shows a connection rather than making one. The control that makes one
 * is ringed and opened, because that is where a reader will come looking
 * for it, but the far end the tour then walks to is whatever the deployment
 * already has — a tour must leave the product as it found it, and a
 * connection is a change to two spaces rather than one.
 *
 * The opening step carries no anchor: what a connection is for is an idea
 * rather than a button.
 */
export const LINKING_TOUR: readonly TourStep[] = [
  {
    id: "why",
    route: () => "/projects",
    title: "Nothing is only in one place",
    body:
      "A decision taken in one space is often the answer to a question asked in another. Rather than copying it, TOME connects the page to the other space: it shows up in that space's related content, and that space's agent can read it.",
  },
  {
    id: "connect",
    anchor: "page-tags",
    waitingAnchor: "page-edit",
    // The page is opened for editing and the picker with it, and both are
    // put back on the way out — Edit by way of Cancel, which discards the
    // draft that opening the editor leaves behind. The hint is what is left
    // when Edit cannot be pressed: no permission, or a draft of the
    // reader's waiting on this page that Cancel would throw away.
    opens: ["page-edit", "page-tags"],
    hint: "Choose Edit — Connect to a space sits with the page's own details.",
    route: wikiPageRoute,
    title: "Connect a page to another space",
    body:
      "Pick the space and the connection is kept in the page's own details, so it survives an ingest that rewrites the body. To connect a single paragraph instead, type # in the editor and pick the space there.",
    unavailable: NO_PAGE,
  },
  {
    id: "related",
    anchor: "space-related",
    route: (subject) =>
      subject.otherSlug ? `/projects/${subject.otherSlug}/tome/wiki` : null,
    title: "Now stand in the other space",
    body:
      "This is a different space, and nobody here did anything. Related content is in its rail all the same, counting the pages written elsewhere that tag it — the far end of every connection made towards it.",
    unavailable: NO_SECOND_SPACE,
  },
  {
    id: "mentions",
    anchor: "space-related-list",
    route: (subject) =>
      subject.otherSlug ? `/projects/${subject.otherSlug}/tome/related` : null,
    title: "What the rest of the organisation says about it",
    body:
      "Each row names the space the page lives in and whether the whole page or only a passage points here, so it can be read in place rather than copied. The same pages go into this space's agent knowledge, which is why a connection is worth making rather than a link worth pasting.",
    unavailable: NO_SECOND_SPACE,
  },
  {
    id: "overview",
    anchor: "project-home",
    route: (subject) =>
      subject.otherSlug ? `/projects/${subject.otherSlug}/tome` : null,
    title: "And it reaches this space's overview",
    body:
      "Home is where someone who works here starts their week, and what other spaces have connected to this one is gathered into it alongside what moved and what is waiting — so the page you wrote over there is read by the people it was written for.",
    unavailable: NO_SECOND_SPACE,
  },
];
