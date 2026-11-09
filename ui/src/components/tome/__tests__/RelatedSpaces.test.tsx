/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import {
  RelatedSpacesBlock,
  RelatedSpacesRail,
} from "@/components/tome/RelatedSpaces";

const RELATED = [
  {
    slug: "second-example-project",
    title: "Second Example Project",
    through: ["Field Events", "Webinars"],
  },
];

describe("RelatedSpaces", () => {
  it("links the rail straight into the other space's TOME", () => {
    render(<RelatedSpacesRail related={RELATED} />);

    expect(
      screen.getByRole("link", { name: /Second Example Project/ }),
    ).toHaveAttribute("href", "/projects/second-example-project/tome");
  });

  it("names what relates the two, since the relation is the point", () => {
    render(<RelatedSpacesBlock related={RELATED} />);

    expect(screen.getByText("Field Events · Webinars")).toBeInTheDocument();
  });

  it("draws nothing at all when nothing was tagged alongside", () => {
    const { container: rail } = render(<RelatedSpacesRail related={[]} />);
    const { container: block } = render(<RelatedSpacesBlock related={[]} />);

    // Not an empty heading: Connections still holds the sources, and a
    // heading over nothing would read as something having failed to load.
    expect(rail).toBeEmptyDOMElement();
    expect(block).toBeEmptyDOMElement();
  });
});
