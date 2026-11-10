import type { TourStep, TourSubject } from "@/components/tour/tour";

/** The borrowed page, for the steps that need one open. */
export function pageRoute(subject: TourSubject): string | null {
  if (!subject.slug || !subject.pagePath) return null;
  const path = subject.pagePath.split("/").map(encodeURIComponent).join("/");
  return `/projects/${subject.slug}/tome/wiki/${path}`;
}

const NO_PAGE =
  "This step needs a wiki page to open, and there is not one to borrow yet.";

/**
 * Writing a page: who owns it, how it is written, and who hears about it.
 *
 * Everything after the first step only exists once the page is being
 * edited, which the reader has to do themselves — so each of those points
 * at Edit and says as much until its own control appears. That is the
 * arrangement on purpose: by the time a control is explained, the reader
 * has already done the thing that reveals it.
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
    hint: "Open a dynamic page and choose Edit — only an agent-written page has prompts to shape.",
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
    // See the same step in the notifications tour: Edit stays the reader's,
    // the menu behind it is opened for them.
    opens: ["page-notify"],
    hint: "Choose Edit — the Notifications button appears beside Save.",
    route: pageRoute,
    title: "Saying who should hear about the edit",
    body:
      "Beside Save, because it is part of saving. Tell the people watching or keep the edit quiet, mark it as needing attention, and tag anyone who should read it, with a note saying why.",
    unavailable: NO_PAGE,
  },
];
