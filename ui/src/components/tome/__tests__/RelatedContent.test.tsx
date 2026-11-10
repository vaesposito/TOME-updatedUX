/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import {
  RelatedContentBlock,
  RelatedContentRail,
} from "@/components/tome/RelatedContent";
import type { RelatedContentRow } from "@/hooks/use-related-content";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const RELATED: RelatedContentRow[] = [
  {
    spaceSlug: "other-space",
    spaceTitle: "Other Space",
    path: "notes/kickoff.md",
    title: "Kickoff notes",
    wholePage: true,
    passages: 0,
  },
  {
    spaceSlug: "third-space",
    spaceTitle: "Third Space",
    path: "weekly.md",
    title: "Weekly update",
    wholePage: false,
    passages: 2,
  },
];

describe("RelatedContent", () => {
  it("links each page to where it actually lives", () => {
    render(<RelatedContentRail related={RELATED} />);

    expect(screen.getByRole("link", { name: /Kickoff notes/ })).toHaveAttribute(
      "href",
      "/projects/other-space/tome/wiki/notes/kickoff.md",
    );
  });

  // A reader standing in one space is being sent to another to read the page,
  // and a bare page title would not say where.
  it("names the space each page lives in", () => {
    render(<RelatedContentBlock related={RELATED} />);

    expect(screen.getByText(/Other Space · Whole page/)).toBeInTheDocument();
    expect(screen.getByText(/Third Space · 2 passages/)).toBeInTheDocument();
  });

  it("lists one row per page", () => {
    render(<RelatedContentBlock related={RELATED} />);

    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("renders nothing at all when no page tags the space", () => {
    const { container: rail } = render(<RelatedContentRail related={[]} />);
    const { container: block } = render(<RelatedContentBlock related={[]} />);

    expect(rail).toBeEmptyDOMElement();
    expect(block).toBeEmptyDOMElement();
  });
});
