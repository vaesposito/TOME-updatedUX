/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

import { IssueLabelFilter } from "@/components/tome/IssueLabelFilter";
import type { TomeTrackedIssueLabel } from "@/lib/tome/issue-filter-views";

const labels: TomeTrackedIssueLabel[] = [
  { id: "critical", label: "critical", title: "Critical" },
  { id: "needs-attention", label: "needs attention", title: "Needs Attention" },
  { id: "decision", label: "decision", title: "Decisions" },
];

describe("IssueLabelFilter", () => {
  it("offers every tracked label by its name", () => {
    render(
      <IssueLabelFilter labels={labels} activeLabel="critical" onSelect={jest.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Critical" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Needs Attention" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decisions" })).toBeInTheDocument();
  });

  it("does not repeat the raw label under the name", () => {
    // The rail used to show both. One list of issues narrowed by a label
    // needs the label's name, not the string it is matched on.
    render(
      <IssueLabelFilter labels={labels} activeLabel="critical" onSelect={jest.fn()} />,
    );
    expect(screen.queryByText("needs attention")).not.toBeInTheDocument();
    expect(screen.queryByText("decision")).not.toBeInTheDocument();
  });

  it("marks exactly one as the one being read", () => {
    render(
      <IssueLabelFilter
        labels={labels}
        activeLabel="needs attention"
        onSelect={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Needs Attention" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Critical" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reports the label that was chosen", () => {
    const onSelect = jest.fn();
    render(
      <IssueLabelFilter labels={labels} activeLabel="critical" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Decisions" }));
    expect(onSelect).toHaveBeenCalledWith("decision");
  });

  it("asks before removing a tracker", () => {
    const onRemove = jest.fn();
    render(
      <IssueLabelFilter
        labels={labels}
        activeLabel="critical"
        onSelect={jest.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Critical tracker" }),
    );
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm removal of Critical tracker" }),
    );
    expect(onRemove).toHaveBeenCalledWith(labels[0]);
  });

  it("lets the asking be called off", () => {
    const onRemove = jest.fn();
    render(
      <IssueLabelFilter
        labels={labels}
        activeLabel="critical"
        onSelect={jest.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Critical tracker" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel removal of Critical tracker" }),
    );
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Critical" })).toBeInTheDocument();
  });

  it("offers no removal where there is nowhere for it to go", () => {
    render(
      <IssueLabelFilter labels={labels} activeLabel="critical" onSelect={jest.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: "Remove Critical tracker" }),
    ).not.toBeInTheDocument();
  });

  it("honours a tracker that cannot be removed", () => {
    render(
      <IssueLabelFilter
        labels={labels}
        activeLabel="critical"
        onSelect={jest.fn()}
        onRemove={jest.fn()}
        isRemovable={(tracked) => tracked.id !== "critical"}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Remove Critical tracker" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Decisions tracker" }),
    ).toBeInTheDocument();
  });

  it("keeps whatever adds a label at the end of the row it adds to", () => {
    render(
      <IssueLabelFilter
        labels={labels}
        activeLabel="critical"
        onSelect={jest.fn()}
        action={<button type="button">Add tracked label</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add tracked label" }),
    ).toBeInTheDocument();
  });

  it("still offers to add one when there is nothing to filter by", () => {
    render(
      <IssueLabelFilter
        labels={[]}
        onSelect={jest.fn()}
        action={<button type="button">Add tracked label</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add tracked label" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});
