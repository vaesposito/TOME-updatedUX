/** @jest-environment jsdom */

/**
 * The prompts panel, as a shape rather than as behaviour.
 *
 * It opens inside the writing area, so its height is capped — and a cap is
 * exactly what once fell across Save, leaving the panel's one committing
 * control half-drawn at the bottom edge.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CustomPromptsPanel } from "../CustomPromptsPanel";

describe("CustomPromptsPanel", () => {
  it("keeps Save and Clear all out of the part that scrolls", () => {
    const { container } = render(<CustomPromptsPanel />);

    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    // The fields are what the cap is for.
    expect(scroller).toContainElement(
      screen.getByLabelText("Content prompt") as HTMLElement,
    );
    expect(scroller).not.toContainElement(
      screen.getByRole("button", { name: "Save" }),
    );
    expect(scroller).not.toContainElement(
      screen.getByRole("button", { name: "Clear all" }),
    );
  });

  it("offers nothing to save until something is written", async () => {
    const user = userEvent.setup();
    render(<CustomPromptsPanel />);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByLabelText("Content prompt"), "A weekly recap");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
