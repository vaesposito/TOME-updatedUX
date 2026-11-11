import type { TourStep } from "@/components/tour/tour";

const NO_PROJECT =
  "This step needs a project you can read, and there is not one yet.";

/**
 * Writing a page, from the button that makes one.
 *
 * The tour does not make the page. Every other walkthrough leaves the
 * product exactly as it found it, and a page is the one thing a reader would
 * have to go and delete afterwards — so New page and Write in editor are
 * ringed and asked for rather than pressed. Two hazards fall away with that
 * decision: the dialog has no second press to undo it, so the runner's own
 * putting-back would re-open it and lose the typed name; and the card sits
 * outside the dialog, where a pointer going down on it dismisses the dialog
 * underneath.
 *
 * So only the first step knows where it is. Everything after it is about a
 * page that did not exist when the tour started — `TourSubject` is resolved
 * before the first step and carries one slug and one existing path — and a
 * step that named a route would march the reader off the page they have
 * just written. They carry no `route` at all, which is not the same as a
 * route that comes back empty: that says the step cannot be shown.
 *
 * The prompts step comes last because it has to. A new page is stable, which
 * means it has no prompts to shape until its kind is changed, so the step
 * before it is the one about the kind.
 */
export const EDITING_TOUR: readonly TourStep[] = [
  {
    id: "new",
    anchor: "wiki-new-page",
    route: (subject) =>
      subject.slug ? `/projects/${subject.slug}/tome/wiki` : null,
    title: "A page starts with its name",
    body:
      "New page asks for a name and nothing else. Write in editor opens it straight away, with the name as its first heading; Import instead takes a document you already have. Make one now — the rest of this walkthrough is about what you can do to it.",
    unavailable: NO_PROJECT,
  },
  {
    id: "connect",
    anchor: "page-tags",
    waitingAnchor: "wiki-new-page",
    hint: "Make the page first. Connect to a space sits with the page's own details, once it is open in the editor.",
    title: "Connect it to a space it also belongs to",
    body:
      "A whole-page connection is kept in the page's own details, so it survives an ingest that rewrites the body. The page then shows in that space's related content, and that space's agent can read it. To connect a single paragraph instead, type # in the body and pick the space.",
  },
  {
    id: "notify",
    anchor: "page-notify",
    waitingAnchor: "wiki-new-page",
    opens: ["page-notify"],
    hint: "Make the page first. Notifications appears beside Save, because it is part of saving.",
    title: "Say who should hear about it",
    body:
      "Tell the people watching the space or keep the save quiet, mark it as needing attention, and tag anyone who should read it with a note saying why. Typing @ in the body tags a person there and the same tag is carried into the save, so you do not have to name them twice.",
  },
  {
    id: "kind",
    anchor: "page-kind",
    waitingAnchor: "wiki-new-page",
    opens: ["page-kind"],
    hint: "Make the page first. The kind sits in the page's own row, beside its name.",
    title: "Whose page it is from here on",
    body:
      "A new page is stable: pinned by you, and left alone by every ingest. Dynamic hands it to the agent, which rewrites it each time it reads the sources. Hidden makes it the agent's own memory, which nobody is shown. Choose Dynamic to see what the next step is about.",
  },
  {
    id: "prompts",
    anchor: "custom-prompts",
    // Only a dynamic page has prompts, so the way in is the kind rather than
    // the editor: a stable page is already open and still has nothing here.
    waitingAnchor: "page-kind",
    hint: "Change the kind to Dynamic — only an agent-written page has prompts to shape.",
    title: "Telling the agent what a dynamic page should say",
    body:
      "Two prompts, inside the writing area and above the page they govern: the content prompt says what the page should contain, and the source prompt says which of the space's sources the agent should build it from. Change either and the next ingest writes to it.",
  },
];
