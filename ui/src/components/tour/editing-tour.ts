import type { TourStep, TourSubject } from "@/components/tour/tour";

/** The borrowed page, for the steps that need one open. */
export function pageRoute(subject: TourSubject): string | null {
  if (!subject.slug || !subject.pagePath) return null;
  const path = subject.pagePath.split("/").map(encodeURIComponent).join("/");
  return `/projects/${subject.slug}/tome/wiki/${path}`;
}

const NO_PAGE =
  "This step needs a wiki page to open, and there is not one to borrow yet.";

/** What the middle of the tour needs open, and how it is given back. */
const IN_THE_EDITOR = ["page-edit"] as const;

/**
 * Writing a page: who owns it, how it is written, and who hears about it.
 *
 * Everything between the first step and the last only exists once the page
 * is being edited, so those steps open the editor themselves and close it
 * again behind them — Cancel rather than Save, which discards the draft the
 * editor writes on opening. A reader who cannot edit this page, or who has
 * a draft waiting on it that Cancel would throw away, is asked instead: the
 * hint is what each of those steps falls back to.
 *
 * It ends outside the page, on the shape of the wiki that holds it.
 */
export const EDITING_TOUR: readonly TourStep[] = [
  {
    id: "open",
    anchor: "page-edit",
    route: pageRoute,
    title: "A page is yours, or the agent's",
    body:
      "Pages declare a kind. Stable pages are pinned by you and the agent leaves them alone; dynamic pages are rewritten on every ingest to stay current; hidden ones are the agent's own memory. Edit opens whichever this is.",
    unavailable: NO_PAGE,
  },
  {
    id: "modes",
    anchor: "editor-mode",
    waitingAnchor: "page-edit",
    opens: IN_THE_EDITOR,
    hint: "Choose Edit — the editor's own controls appear in its formatting bar.",
    route: pageRoute,
    title: "Three ways to write the same page",
    body:
      "Rich text for prose, Markdown when you want the source, Preview for reading it back. The toggle sits in the formatting bar, with the editor rather than with the page.",
    unavailable: NO_PAGE,
  },
  {
    id: "prompts",
    anchor: "custom-prompts",
    waitingAnchor: "page-edit",
    opens: IN_THE_EDITOR,
    // Opening the editor is not enough here: a stable page has no prompts
    // to shape, and the reader has to be on one that does.
    hint: "Open a dynamic page — only an agent-written page has prompts to shape.",
    route: pageRoute,
    title: "Telling the agent what a dynamic page should say",
    body:
      "A dynamic page carries two prompts: what the page should contain, and which sources the agent should build it from. They sit inside the writing area, above the page they govern.",
    unavailable: NO_PAGE,
  },
  {
    id: "notify",
    anchor: "page-notify",
    waitingAnchor: "page-edit",
    opens: [...IN_THE_EDITOR, "page-notify"],
    hint: "Choose Edit — the Notifications button appears beside Save.",
    route: pageRoute,
    title: "Saying who should hear about the edit",
    body:
      "Beside Save, because it is part of saving. Tell the people watching or keep the edit quiet, mark it as needing attention, and tag anyone who should read it, with a note saying why.",
    unavailable: NO_PAGE,
  },
  {
    id: "delete",
    anchor: "page-delete",
    waitingAnchor: "page-edit",
    opens: IN_THE_EDITOR,
    hint: "Choose Edit — Delete sits at the end of the row, apart from Save.",
    route: pageRoute,
    title: "Removing the page you are writing",
    body:
      "In the cluster that ends the edit, but held apart from Cancel and Save: those two decide what happens to this edit, while Delete decides what happens to the page. Only pages you may write are offered it, and a mirrored page never is — its source would write it straight back.",
    unavailable: NO_PAGE,
  },
  {
    id: "arrange",
    anchor: "wiki-arrange",
    // The wiki's own index, where the tree's controls live. The last step
    // steps back out of the page on purpose: what it is about is the shape
    // of the wiki rather than anything inside one document.
    route: (subject) =>
      subject.slug ? `/projects/${subject.slug}/tome/wiki` : null,
    opens: ["wiki-arrange"],
    title: "Arranging the wiki itself",
    body:
      "Edit here turns the rail into something you can rearrange: drag a page to reorder it or move it under another, or do the same from the keyboard, and remove one where it sits. It changes where pages are, never what they say — that is edited on the page.",
    unavailable: "This step needs a project you can read, and there is not one yet.",
  },
];
