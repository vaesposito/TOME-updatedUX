import { fireEvent, render, screen } from "@testing-library/react";

import { TOME_TRACKED_ISSUE_LABELS } from "@/lib/tome/issue-filter-views";
import { IssueLabelViewList } from "../IssueLabelViewList";

describe("IssueLabelViewList", () => {
  it("renders configured labels in product order", () => {
    const onSelect = jest.fn();
    render(
      <IssueLabelViewList
        labels={TOME_TRACKED_ISSUE_LABELS}
        activeLabel="needs attention"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    expect(screen.getByText("Decisions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Critical" }));
    expect(onSelect).toHaveBeenCalledWith("critical");
  });

  it("confirms custom tracker removal inline without exposing removal for built-ins", () => {
    const onRemove = jest.fn();
    render(
      <IssueLabelViewList
        labels={[
          ...TOME_TRACKED_ISSUE_LABELS,
          { id: "security-review", label: "security-review", title: "Security Review" },
        ]}
        onSelect={jest.fn()}
        onRemove={onRemove}
        isRemovable={(tracked) => tracked.id === "security-review"}
      />,
    );

    expect(screen.queryByRole("button", { name: "Remove Critical tracker" })).not.toBeInTheDocument();
    const removeButton = screen.getByRole("button", { name: "Remove Security Review tracker" });
    expect(removeButton).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
      "focus-visible:opacity-100",
      "[@media(hover:none)]:opacity-100",
    );
    fireEvent.click(removeButton);
    expect(onRemove).not.toHaveBeenCalled();
    expect(
      screen.getByRole("group", { name: "Confirm removal of Security Review tracker" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel removal of Security Review tracker" }),
    );
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove Security Review tracker" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm removal of Security Review tracker" }),
    );
    expect(onRemove).toHaveBeenCalledWith({
      id: "security-review",
      label: "security-review",
      title: "Security Review",
    });
  });

  it("offers removal for built-in trackers when the caller grants permission", () => {
    const onRemove = jest.fn();
    render(
      <IssueLabelViewList
        labels={TOME_TRACKED_ISSUE_LABELS}
        onSelect={jest.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Critical tracker" }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal of Critical tracker" }));
    expect(onRemove).toHaveBeenCalledWith(TOME_TRACKED_ISSUE_LABELS[0]);
  });
});
