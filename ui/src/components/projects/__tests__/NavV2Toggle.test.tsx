import { fireEvent, render, screen } from "@testing-library/react";

import { NavV2Toggle } from "@/components/projects/NavV2Toggle";
import { useFeatureFlagStore } from "@/store/feature-flag-store";

describe("NavV2Toggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useFeatureFlagStore.setState({ flags: {}, touched: {}, initialized: false });
  });

  function toggle() {
    return screen.getByRole("switch", { name: "New project navigation" });
  }

  it("starts off, because the flag ships off", () => {
    render(<NavV2Toggle />);
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(toggle()).toHaveTextContent("Off");
  });

  it("turns the navigation on", () => {
    render(<NavV2Toggle />);
    fireEvent.click(toggle());
    expect(useFeatureFlagStore.getState().isEnabled("tomeNavV2")).toBe(true);
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(toggle()).toHaveTextContent("On");
  });

  it("turns it back off again", () => {
    render(<NavV2Toggle />);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(useFeatureFlagStore.getState().isEnabled("tomeNavV2")).toBe(false);
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });

  it("reads the state it was left in", () => {
    window.localStorage.setItem(
      "caipe-feature-flags",
      JSON.stringify({ tomeNavV2: true }),
    );
    render(<NavV2Toggle />);
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  // The account preference is allowed to win over localStorage for a flag the
  // reader has not touched, so a click has to say "touched" or the next
  // settings read would undo it.
  it("marks the flag as the reader's own doing", () => {
    render(<NavV2Toggle />);
    fireEvent.click(toggle());
    expect(useFeatureFlagStore.getState().touched.tomeNavV2).toBe(true);
  });

  it("explains what it does before it is turned on", () => {
    render(<NavV2Toggle />);
    expect(toggle()).toHaveAttribute("aria-label", "New project navigation");
  });
});
