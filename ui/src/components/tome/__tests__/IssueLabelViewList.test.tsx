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

  it("offers removal for custom trackers without exposing it for built-ins", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Remove Security Review tracker" }));
    expect(onRemove).toHaveBeenCalledWith({
      id: "security-review",
      label: "security-review",
      title: "Security Review",
    });
  });
});
