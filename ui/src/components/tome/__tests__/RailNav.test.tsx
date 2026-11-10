import { fireEvent, render, screen } from "@testing-library/react";

import {
  NavItem,
  NavSection,
  NavSectionAction,
} from "@/components/tome/RailNav";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderRail(ui: React.ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("NavSection", () => {
  it("goes somewhere and opens when the row is clicked", () => {
    const onClick = jest.fn();
    const onToggle = jest.fn();

    renderRail(
      <NavSection
        icon={<span />}
        label="Wiki"
        active={false}
        expanded={false}
        onToggle={onToggle}
        onClick={onClick}
        controlsId="wiki-tree"
      >
        <p>Charter</p>
      </NavSection>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Wiki" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("opens from the caret without going anywhere", () => {
    const onClick = jest.fn();
    const onToggle = jest.fn();

    renderRail(
      <NavSection
        icon={<span />}
        label="Wiki"
        active={false}
        expanded={false}
        onToggle={onToggle}
        onClick={onClick}
        controlsId="wiki-tree"
      >
        <p>Charter</p>
      </NavSection>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand Wiki" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    // After the row, not before it: the caret is reached from the edge the
    // whole sidebar is toggled from.
    const caret = screen.getByRole("button", { name: "Expand Wiki" });
    const row = screen.getByRole("button", { name: "Wiki" });
    expect(row.parentElement?.lastElementChild).toBe(caret);
  });

  it("counts what is under a section, so it need not be opened to find out", () => {
    renderRail(
      <NavSection
        icon={<span />}
        label="Wiki"
        active={false}
        expanded={false}
        count={3}
        onToggle={jest.fn()}
        onClick={jest.fn()}
        controlsId="wiki-tree"
      >
        <p>Charter</p>
      </NavSection>,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("says nothing about a count it does not have yet", () => {
    renderRail(
      <NavSection
        icon={<span />}
        label="Wiki"
        active={false}
        expanded={false}
        onToggle={jest.fn()}
        onClick={jest.fn()}
        controlsId="wiki-tree"
      >
        <p>Charter</p>
      </NavSection>,
    );

    // A nought would be a count, and while the tree is still arriving it
    // would be the wrong one.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("counts a section at nought rather than making it be opened to find out", () => {
    const onToggle = jest.fn();

    renderRail(
      <NavSection
        icon={<span />}
        label="Connections"
        active={false}
        expanded={false}
        count={0}
        onToggle={onToggle}
        onClick={jest.fn()}
        controlsId="references-tree"
      >
        <p>Should never render</p>
      </NavSection>,
    );

    expect(screen.getByText("0")).toBeInTheDocument();
    // No caret: it would promise something to open.
    expect(
      screen.queryByRole("button", { name: /Expand|Collapse/ }),
    ).not.toBeInTheDocument();

    // The row still goes somewhere, because its landing view explains itself
    // — but it does not claim to open, which is the one thing it has just
    // said it cannot do.
    const row = screen.getByRole("button", { name: "Connections" });
    expect(row).not.toHaveAttribute("aria-expanded");
    fireEvent.click(row);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps an empty section shut even if something says it is open", () => {
    renderRail(
      <NavSection
        icon={<span />}
        label="Wiki"
        active={false}
        expanded
        count={0}
        onToggle={jest.fn()}
        onClick={jest.fn()}
        controlsId="wiki-tree"
      >
        <p>Should never render</p>
      </NavSection>,
    );

    expect(screen.queryByText("Should never render")).not.toBeInTheDocument();
  });

  it("hides what is underneath until it is expanded", () => {
    const { rerender } = renderRail(
      <NavSection
        icon={<span />}
        label="Wiki"
        active={false}
        expanded={false}
        onToggle={jest.fn()}
        onClick={jest.fn()}
        controlsId="wiki-tree"
      >
        <p>Charter</p>
      </NavSection>,
    );

    expect(screen.queryByText("Charter")).not.toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <NavSection
          icon={<span />}
          label="Wiki"
          active={false}
          expanded
          onToggle={jest.fn()}
          onClick={jest.fn()}
          controlsId="wiki-tree"
        >
          <p>Charter</p>
        </NavSection>
      </TooltipProvider>,
    );

    expect(screen.getByText("Charter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Wiki" })).toHaveAttribute(
      "aria-controls",
      "wiki-tree",
    );
  });

  it("ties what it opened back to the row it came from", () => {
    renderRail(
      <NavSection
        icon={<span />}
        label="Wiki"
        active={false}
        expanded
        onToggle={jest.fn()}
        onClick={jest.fn()}
        controlsId="wiki-tree"
      >
        <p>Charter</p>
      </NavSection>,
    );

    // A line down the left of the contents, and nothing a reader is told
    // about: it says what the indent already says.
    const guide = document
      .getElementById("wiki-tree")
      ?.querySelector("span[aria-hidden]");
    expect(guide).toBeTruthy();
    expect(guide).toHaveClass("absolute", "w-px");
  });
});

describe("NavItem", () => {
  it("navigates when clicked", () => {
    const onClick = jest.fn();
    renderRail(
      <NavItem icon={<span />} label="Overview" active={false} onClick={onClick} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("offers no caret, since there is nothing under it to open", () => {
    renderRail(
      <NavItem
        icon={<span />}
        label="Overview"
        active={false}
        onClick={jest.fn()}
        reserveCaret
      />,
    );

    expect(screen.queryByRole("button", { name: /Expand|Collapse/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("holds the caret's column open so the rail lines up", () => {
    const { container, rerender } = renderRail(
      <NavItem
        icon={<span data-testid="icon" />}
        label="Overview"
        active={false}
        onClick={jest.fn()}
        reserveCaret
      />,
    );

    const spacer = container.querySelector("span[aria-hidden]");
    expect(spacer).toBeInTheDocument();
    expect(spacer).toHaveClass("w-3.5");

    // A rail with no sections has nothing to line up with, so the column is
    // opt-in rather than always there.
    rerender(
      <TooltipProvider>
        <NavItem icon={<span />} label="Overview" active={false} onClick={jest.fn()} />
      </TooltipProvider>,
    );
    expect(container.querySelector("span[aria-hidden]")).not.toBeInTheDocument();
  });

  it("reserves the column at the trailing edge, where the carets are", () => {
    const { container } = renderRail(
      <NavItem
        icon={<span />}
        label="Overview"
        active={false}
        onClick={jest.fn()}
        reserveCaret
      />,
    );

    const row = screen.getByRole("button", { name: "Overview" });
    const spacer = container.querySelector("span[aria-hidden]");
    expect(row.lastElementChild?.lastElementChild).toBe(spacer);
  });

  it("says how much it leads to, nought included", () => {
    const { rerender } = renderRail(
      <NavItem
        icon={<span />}
        label="Issues"
        active={false}
        onClick={jest.fn()}
        count={0}
        reserveCaret
      />,
    );

    // The point of the figure: a reader learns the row is empty without
    // spending a click to find out.
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <NavItem
          icon={<span />}
          label="Issues"
          active={false}
          onClick={jest.fn()}
          count={4}
          reserveCaret
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows nothing at all until the count is known", () => {
    renderRail(
      <NavItem
        icon={<span />}
        label="Issues"
        active={false}
        onClick={jest.fn()}
        reserveCaret
      />,
    );

    // A nought while loading would be a count, and a wrong one.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("puts its figure in the same column a section's sits in", () => {
    renderRail(
      <>
        <NavItem
          icon={<span />}
          label="Issues"
          active={false}
          onClick={jest.fn()}
          count={0}
          reserveCaret
        />
        <NavSection
          icon={<span />}
          label="Wiki"
          active={false}
          expanded={false}
          onToggle={jest.fn()}
          onClick={jest.fn()}
          controlsId="wiki-tree"
          count={3}
        >
          <p>Charter</p>
        </NavSection>
      </>,
    );

    // Both figures are followed by the caret column and nothing else, which
    // is what holds them to one column down the rail. Measuring is a
    // browser's job; what a test can hold is the structure that makes the
    // measurement come out.
    const itemFigure = screen.getByText("0");
    const sectionFigure = screen.getByText("3");
    expect(itemFigure.nextElementSibling).toHaveClass("w-3.5");
    expect(sectionFigure.nextElementSibling).toHaveAttribute(
      "aria-label",
      "Expand Wiki",
    );
    expect(sectionFigure.nextElementSibling?.className).not.toContain("pl-1");
  });
  it("lightens a row that leads nowhere, and leaves a filled one alone", () => {
    render(
      <>
        <NavItem
          icon={<span />}
          label="Notes"
          active={false}
          onClick={jest.fn()}
          count={0}
        />
        <NavItem
          icon={<span />}
          label="Meetings"
          active={false}
          onClick={jest.fn()}
          count={2}
        />
      </>,
    );

    const nowhere = screen.getByText("Notes").closest("button");
    const filled = screen.getByText("Meetings").closest("button");
    expect(nowhere?.className).toContain("text-muted-foreground/60");
    expect(filled?.className).not.toContain("text-muted-foreground/60");
  });
  it("lightens a section holding nothing, such as a source with nothing read from it", () => {
    render(
      <>
        <NavSection
          icon={<span />}
          label="Confluence"
          active={false}
          expanded={false}
          onToggle={jest.fn()}
          onClick={jest.fn()}
          controlsId="confluence"
          count={0}
        >
          <p>nothing</p>
        </NavSection>
        <NavSection
          icon={<span />}
          label="GitHub"
          active={false}
          expanded={false}
          onToggle={jest.fn()}
          onClick={jest.fn()}
          controlsId="github"
          count={4}
        >
          <p>something</p>
        </NavSection>
      </>,
    );

    const row = (name: string) =>
      screen.getByText(name).closest("div[class*='rounded-md']")?.className ?? "";
    expect(row("Confluence")).toContain("text-muted-foreground/60");
    expect(row("GitHub")).not.toContain("text-muted-foreground/60");
  });
});

describe("NavSection header actions", () => {
  const section = (actions?: React.ReactNode) => (
    <NavSection
      icon={<span />}
      label="Wiki"
      active={false}
      expanded
      onToggle={jest.fn()}
      onClick={jest.fn()}
      controlsId="wiki-tree"
      count={3}
      actions={actions}
    >
      <p>Charter</p>
    </NavSection>
  );

  it("writes a page from the section header without opening the section", () => {
    const onNewPage = jest.fn();
    const onClick = jest.fn();

    renderRail(
      <NavSection
        icon={<span />}
        label="Wiki"
        active={false}
        expanded
        onToggle={jest.fn()}
        onClick={onClick}
        controlsId="wiki-tree"
        count={3}
        actions={
          <NavSectionAction label="New page" onClick={onNewPage}>
            <span />
          </NavSectionAction>
        }
      >
        <p>Charter</p>
      </NavSection>,
    );

    fireEvent.click(screen.getByRole("button", { name: "New page" }));
    expect(onNewPage).toHaveBeenCalledTimes(1);
    // Asking for a page in the section is not asking to go to the section.
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the count's column by standing in its place, not beside it", () => {
    const { container } = renderRail(
      section(
        <NavSectionAction label="New page" onClick={jest.fn()}>
          <span />
        </NavSectionAction>,
      ),
    );

    const count = screen.getByText("3");
    expect(count.className).toContain("group-hover/section:hidden");
    expect(
      container.querySelector(".group-hover\\/section\\:flex"),
    ).not.toBeNull();
  });

  it("leaves the count alone where the header does nothing", () => {
    renderRail(section(undefined));

    expect(screen.queryByRole("button", { name: "New page" })).toBeNull();
    expect(screen.getByText("3").className).not.toContain("group-hover/section:hidden");
  });
});
