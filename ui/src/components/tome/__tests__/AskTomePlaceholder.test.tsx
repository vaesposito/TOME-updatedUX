/** @jest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";

import { AskTomePlaceholder } from "@/components/tome/AskTomePlaceholder";
import {
  ASK_TOME_DEFAULT_SIZE,
  useAskTomeStore,
} from "@/store/ask-tome-store";

const settings = jest.fn();
jest.mock("@/hooks/use-tome-assistant-settings", () => ({
  useTomeAssistantSettings: () => settings(),
}));

describe("AskTomePlaceholder", () => {
  beforeEach(() => {
    settings.mockReturnValue({ tome_assistant_popup_enabled: false, agent_id: null });
    // The panel's state outlives the component on purpose, so each test has
    // to put it back or it inherits the last one's panel.
    useAskTomeStore.setState({
      open: false,
      tab: "chat",
      expanded: false,
      size: ASK_TOME_DEFAULT_SIZE,
    });
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

    for (const label of ["Ask Tome options", "Close Ask Tome"]) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
    expect(
      screen.getByRole("button", { name: "Open Ask Tome in the chat space" }),
    ).toBeDisabled();
  });

  it("keeps what acts on the chat in one menu, as the real panel does", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Tome options" }));

    expect(screen.getByRole("button", { name: "New chat" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Expand chat" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset size" })).toBeEnabled();
  });

  it("expands from the menu, and offers the way back", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Tome options" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand chat" }));

    expect(useAskTomeStore.getState().expanded).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Ask Tome options" }));
    expect(screen.getByRole("button", { name: "Reduce chat" })).toBeInTheDocument();
  });

  it("puts a dragged panel back, and the expanded one with it", () => {
    useAskTomeStore.setState({ size: { width: 900, height: 900 }, expanded: true });
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Tome options" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset size" }));

    expect(useAskTomeStore.getState().size).toEqual(ASK_TOME_DEFAULT_SIZE);
    expect(useAskTomeStore.getState().expanded).toBe(false);
  });

  it("tells the reader how to reach Tome in Webex, and keeps telling them", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));
    expect(screen.queryByRole("region", { name: "Configure Webex" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Configure Webex" }));
    const note = screen.getByRole("region", { name: "Configure Webex" });
    expect(within(note).getAllByRole("listitem").map((step) => step.textContent)).toEqual([
      "Go to Webex.",
      // The address, so the reader searches for the one bot rather than the
      // word.
      "Search for tome@webex.bot.",
      "Start a conversation with the Tome agent.",
    ]);

    // Nothing outside it dismisses it: a reader works through the steps with
    // the rest of the page still under their pointer.
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByRole("region", { name: "Configure Webex" })).toBeInTheDocument();

    fireEvent.click(within(note).getByRole("button", { name: "Close the Webex steps" }));
    expect(screen.queryByRole("region", { name: "Configure Webex" })).not.toBeInTheDocument();
  });

  it("opens on Chat and offers History, and offers nothing else", () => {
    render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Chat",
      "History",
    ]);
    expect(screen.getByRole("tab", { name: "Chat", selected: true })).toBeInTheDocument();
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

  it("stays open, and on the same tab, when the surface under it changes", () => {
    // Following a link from the hub into a space takes this component down
    // and puts another up. A reader who opened the panel did not ask for it
    // to be shut again on the way.
    const first = render(<AskTomePlaceholder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ask Tome" }));
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    first.unmount();

    render(<AskTomePlaceholder />);
    expect(screen.getByRole("dialog", { name: "Ask Tome" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History", selected: true })).toBeInTheDocument();
  });

  it("leaves room at the foot of the page when a surface asks for it", () => {
    useAskTomeStore.setState({ open: true });
    const { container } = render(<AskTomePlaceholder bottomInset={88} />);
    expect(container.firstChild).toHaveStyle({ bottom: "88px" });
  });
});
