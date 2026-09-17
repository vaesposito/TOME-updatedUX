import { fireEvent, render, screen } from "@testing-library/react";

import { StandupView } from "../StandupView";

jest.mock("@/components/shared/timeline/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

describe("StandupView headline", () => {
  it("shows a smaller summary and reveals the full headline on focus", async () => {
    render(
      <StandupView
        markdown={`---
title: The Standup
kind: report
---
## Headline

**The deployment is complete.** Detailed verification passed across every supported environment.

## Progress

- Release deployed
`}
      />,
    );

    const headline = screen.getByRole("heading", {
      level: 1,
      name: "The deployment is complete.",
    });
    expect(headline).toHaveClass("text-xl", "sm:text-2xl", "line-clamp-2");
    expect(headline).toHaveAttribute("tabindex", "0");

    fireEvent.focus(headline);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Full headline");
    expect(tooltip).toHaveTextContent(
      "The deployment is complete. Detailed verification passed across every supported environment.",
    );

    fireEvent.blur(headline);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
