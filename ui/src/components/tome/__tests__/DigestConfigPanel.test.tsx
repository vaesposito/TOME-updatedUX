/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

const getSettings = jest.fn();
const updateNotifications = jest.fn();

jest.mock("@/lib/api-client", () => ({
  apiClient: {
    getSettings: () => getSettings(),
    updateNotifications: (body: unknown) => updateNotifications(body),
  },
}));

import { DigestConfigPanel } from "@/components/tome/DigestConfigPanel";

describe("DigestConfigPanel", () => {
  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue({ notifications: {} });
    updateNotifications.mockReset().mockResolvedValue({});
  });

  it("asks the three questions in the order they are answered", async () => {
    render(<DigestConfigPanel onBack={jest.fn()} />);
    expect(
      screen.getByText("What would you like to be updated on?"),
    ).toBeInTheDocument();
    expect(screen.getByText("How often?")).toBeInTheDocument();
    expect(screen.getByText("Where?")).toBeInTheDocument();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
  });

  it("ships as Monday morning", async () => {
    render(<DigestConfigPanel onBack={jest.fn()} />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.getByLabelText("How often")).toHaveValue("weekly");
    expect(screen.getByLabelText("Which day")).toHaveValue("1");
    expect(screen.getByLabelText("What time")).toHaveValue("9");
  });

  it("reads back what was stored", async () => {
    getSettings.mockResolvedValue({
      notifications: {
        tome_digest: {
          topic: "Where each project stands",
          frequency: "fortnightly",
          weekday: 4,
          hour: 17,
        },
      },
    });
    render(<DigestConfigPanel onBack={jest.fn()} />);
    expect(
      await screen.findByDisplayValue("Where each project stands"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("How often")).toHaveValue("fortnightly");
    expect(screen.getByLabelText("What time")).toHaveValue("17");
  });

  it("drops the day when the day would mean nothing", async () => {
    render(<DigestConfigPanel onBack={jest.fn()} />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("How often"), {
      target: { value: "daily" },
    });
    expect(screen.queryByLabelText("Which day")).not.toBeInTheDocument();
    expect(screen.getByLabelText("What time")).toBeInTheDocument();
  });

  it("offers Save only once there is something to save", async () => {
    render(<DigestConfigPanel onBack={jest.fn()} />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What time"), {
      target: { value: "8" },
    });
    expect(save).toBeEnabled();
  });

  it("says Saved only in reply to a save", async () => {
    render(<DigestConfigPanel onBack={jest.fn()} />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What time"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("stores the schedule on the reader", async () => {
    render(<DigestConfigPanel onBack={jest.fn()} />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  Anything waiting on a decision  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateNotifications).toHaveBeenCalledWith({
        tome_digest: {
          topic: "Anything waiting on a decision",
          frequency: "weekly",
          weekday: 1,
          hour: 9,
        },
      }),
    );
  });

  it("says so rather than pretending, when the save does not land", async () => {
    updateNotifications.mockRejectedValue(new Error("nope"));
    render(<DigestConfigPanel onBack={jest.fn()} />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("What time"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/didn't save/)).toBeInTheDocument();
    // Still offered, because the thing to do about it is try again.
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("stays usable when the settings cannot be read", async () => {
    getSettings.mockRejectedValue(new Error("nope"));
    render(<DigestConfigPanel onBack={jest.fn()} />);
    // The defaults are already on screen and are a usable answer.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
    fireEvent.change(screen.getByLabelText("What time"), {
      target: { value: "8" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows Webex as somewhere a digest will go, and not yet", async () => {
    render(<DigestConfigPanel onBack={jest.fn()} />);
    expect(screen.getByRole("switch", { name: "Send on Webex" })).toBeDisabled();
    expect(
      screen.getByText(/Webex isn't connected yet/),
    ).toBeInTheDocument();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
  });

  it("goes back to the digest", async () => {
    const onBack = jest.fn();
    render(<DigestConfigPanel onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to the digest" }));
    expect(onBack).toHaveBeenCalled();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
  });
});
