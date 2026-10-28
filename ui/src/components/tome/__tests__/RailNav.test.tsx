import { fireEvent, render, screen } from "@testing-library/react";

import { NavItem, NavSection } from "@/components/tome/RailNav";
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

  it("says a section is empty rather than making it be opened to find out", () => {
    const onToggle = jest.fn();

    renderRail(
      <NavSection
        icon={<span />}
        label="Referencing Projects"
        active={false}
        expanded={false}
        empty
        onToggle={onToggle}
        onClick={jest.fn()}
        controlsId="references-tree"
      >
        <p>Should never render</p>
      </NavSection>,
    );

    expect(screen.getByText("Empty")).toBeInTheDocument();
    // No caret: it would promise something to open.
    expect(
      screen.queryByRole("button", { name: /Expand|Collapse/ }),
    ).not.toBeInTheDocument();

    // The row still goes somewhere, because its landing view explains itself
    // — but it does not claim to open, which is the one thing it has just
    // said it cannot do.
    const row = screen.getByRole("button", { name: "Referencing Projects" });
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
        empty
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
    expect(row.lastElementChild).toBe(container.querySelector("span[aria-hidden]"));
  });
});
