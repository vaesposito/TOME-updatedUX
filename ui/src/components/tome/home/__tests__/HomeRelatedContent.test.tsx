/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import { TOME_HOME_WIDGETS, widgetLabel } from "@/lib/tome/home-widgets";
import type { RelatedContentRow } from "@/hooks/use-related-content";

import { HomeRelatedContent } from "../HomeRelatedContent";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const HREF = "/projects/example-project/tome/related";

function row(overrides: Partial<RelatedContentRow> = {}): RelatedContentRow {
  return {
    spaceSlug: "other-space",
    spaceTitle: "Other Space",
    path: "notes/kickoff.md",
    title: "Kickoff notes",
    wholePage: true,
    passages: 0,
    ...overrides,
  };
}

/** `count` rows, each a different page so nothing is deduplicated by key. */
function rows(count: number): RelatedContentRow[] {
  return Array.from({ length: count }, (_, index) =>
    row({ path: `notes/page-${index}.md`, title: `Page ${index}` }),
  );
}

describe("HomeRelatedContent", () => {
  it("names each page and the space it lives in", () => {
    render(
      <HomeRelatedContent
        related={[
          row(),
          row({
            spaceSlug: "third-space",
            spaceTitle: "Third Space",
            path: "weekly.md",
            title: "Weekly update",
            wholePage: false,
            passages: 2,
          }),
        ]}
        relatedHref={HREF}
      />,
    );

    expect(screen.getByText("Kickoff notes")).toBeInTheDocument();
    expect(screen.getByText("Other Space · Whole page")).toBeInTheDocument();
    expect(screen.getByText("Third Space · 2 passages")).toBeInTheDocument();
  });

  it("sends a reader to the space the page actually lives in", () => {
    render(<HomeRelatedContent related={[row()]} relatedHref={HREF} />);

    expect(screen.getByRole("link", { name: /Kickoff notes/ })).toHaveAttribute(
      "href",
      "/projects/other-space/tome/wiki/notes/kickoff.md",
    );
  });

  it("says nothing tags the space when nothing does", () => {
    render(<HomeRelatedContent related={[]} relatedHref={HREF} />);

    expect(screen.getByText("Nothing tags this space yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A page in another space that tags this one appears here, with the space it lives in.",
      ),
    ).toBeInTheDocument();
  });

  // Waiting and empty are different states: telling a reader nothing points at
  // their space, a moment before naming the pages that do, is worse than
  // telling them nothing yet.
  it("waits rather than reporting a space nobody points at", () => {
    render(<HomeRelatedContent relatedHref={HREF} />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing tags this space yet"),
    ).not.toBeInTheDocument();
  });

  it("shows the first five and says how many more there are", () => {
    render(<HomeRelatedContent related={rows(8)} relatedHref={HREF} />);

    expect(screen.getByText("Page 0")).toBeInTheDocument();
    expect(screen.getByText("Page 4")).toBeInTheDocument();
    expect(screen.queryByText("Page 5")).not.toBeInTheDocument();
    expect(screen.getByText("and 3 more")).toBeInTheDocument();
  });

  it("counts every page that tags the space, not the rows on show", () => {
    render(<HomeRelatedContent related={rows(8)} relatedHref={HREF} />);

    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("leaves the heading's way through to the whole list", () => {
    render(<HomeRelatedContent related={rows(8)} relatedHref={HREF} />);

    expect(screen.getByRole("link", { name: "All related" })).toHaveAttribute(
      "href",
      HREF,
    );
  });

  it("opens the full view in place where the shell can show it", () => {
    const onOpenRelated = jest.fn();
    render(
      <HomeRelatedContent
        related={rows(8)}
        relatedHref={HREF}
        onOpenRelated={onOpenRelated}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "All related" }));
    expect(onOpenRelated).toHaveBeenCalledTimes(1);
  });

  // The card is handed its rows by the shell, which already reads them to
  // count the rail entry beside this. A card that read them again would ask
  // the index twice for one answer on every visit to a space's home.
  it("reads nothing of its own", () => {
    const fetchSpy = jest.fn();
    const original = global.fetch;
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    try {
      render(<HomeRelatedContent related={rows(8)} relatedHref={HREF} />);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = original;
    }
  });

  // "Tagged for you" is the notification feed's answer to who was named with
  // an @ mention. This card is about which spaces point here. Two cards that
  // read as one thing would teach a reader to ignore whichever they met
  // second.
  it("is not a second reading of who was mentioned", () => {
    render(<HomeRelatedContent related={[row()]} relatedHref={HREF} />);

    expect(screen.getByText("Related content")).toBeInTheDocument();
    expect(screen.queryByText(/tagged you/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mention/i)).not.toBeInTheDocument();
  });

  it("is registered as a card of its own, beside what this space is part of", () => {
    const ids = TOME_HOME_WIDGETS.map((widget) => widget.id);

    expect(widgetLabel("related")).toBe("Related content");
    expect(widgetLabel("tagged")).toBe("Tagged for you");
    expect(ids[ids.indexOf("related") - 1]).toBe("partof");
  });
});
