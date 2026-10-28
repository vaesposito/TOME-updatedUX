/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

import { AskTomePlaceholder } from "@/components/tome/AskTomePlaceholder";

const settings = jest.fn();
jest.mock("@/hooks/use-tome-assistant-settings", () => ({
  useTomeAssistantSettings: () => settings(),
}));

describe("AskTomePlaceholder", () => {
  beforeEach(() => {
    settings.mockReturnValue({ tome_assistant_popup_enabled: false, agent_id: null });
  });

  it("stands aside when the real assistant is switched on", () => {
    settings.mockReturnValue({ tome_assistant_popup_enabled: true, agent_id: "example-agent" });
    const { container } = render(<AskTomePlaceholder />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the pill, and opens on it", () => {
    render(<AskTomePlaceholder />);
    const pill = screen.getByRole("button", { name: "Open Ask Tome" });
    expect(pill).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(pill);
    expect(screen.getByRole("dialog", { name: "Ask Tome" })).toBeInTheDocument();
    expect(pill).toHaveAttribute("aria-expanded", "true");
  });

  it("says plainly that nothing here answers", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));
    expect(screen.getByText(/No assistant is configured/)).toBeInTheDocument();
  });

  it("takes no input, rather than taking it and losing it", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));

    expect(screen.getByLabelText("Ask anything about your projects")).toBeDisabled();
    for (const prompt of screen.getAllByRole("button", { name: /\?$|progress$/ })) {
      expect(prompt).toBeDisabled();
    }
  });

  it("closes again", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Ask Tome" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
