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

    expect(screen.getByLabelText("Ask Tome a question")).toBeDisabled();
    for (const label of ["Send", "Attach a file", "Copy", "Good answer"]) {
      for (const button of screen.getAllByRole("button", { name: label })) {
        expect(button).toBeDisabled();
      }
    }
  });

  it("carries the panel's own controls, live where they can be and shut where they cannot", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));

    for (const label of ["Expand Ask Tome", "Resize Ask Tome", "Close Ask Tome"]) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
    for (const label of [
      "Open Ask Tome in the chat space",
      "Start a new Ask Tome chat",
      "Clear this Ask Tome chat",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
  });

  it("opens on Chat, offers History, and shuts Scheduled", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));

    expect(screen.getByRole("tab", { name: "Chat", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Scheduled" })).toBeDisabled();
    expect(screen.getByText(/What changed across my projects this week\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByRole("tab", { name: "History", selected: true })).toBeInTheDocument();
    expect(screen.getByText("Summarize the open decisions")).toBeInTheDocument();
  });

  it("rates the answer but not the reader's own question", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));

    // Two turns, so a control offered on both appears twice and one offered
    // only on the answer appears once.
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Good answer" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Report" })).toHaveLength(1);
  });

  it("closes again", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Ask Tome" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
