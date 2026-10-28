import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GistsPanel } from "../GistsPanel";

describe("GistsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { gists: [] } }),
    }) as jest.Mock;
  });

  it("asks project readers for a gist name before opening the editor", async () => {
    const onNewGist = jest.fn();
    render(
      <GistsPanel
        slug="example-project"
        canEdit={false}
        onOpenGist={jest.fn()}
        onNewGist={onNewGist}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(screen.getByRole("dialog", { name: "New note" })).toBeInTheDocument();
    expect(onNewGist).not.toHaveBeenCalled();
    const writeButton = screen.getByRole("button", { name: "Write in editor" });
    expect(writeButton).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "New note name" }), {
      target: { value: "  Deployment notes  " },
    });
    expect(writeButton).toBeEnabled();
    fireEvent.click(writeButton);

    expect(onNewGist).toHaveBeenCalledWith("Deployment notes");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });

  it("prefills the name when a browser-local gist draft already exists", async () => {
    window.localStorage.setItem(
      "tome:gist-draft:example-project:new",
      JSON.stringify({ title: "Recovered context" }),
    );

    render(
      <GistsPanel
        slug="example-project"
        canEdit
        onOpenGist={jest.fn()}
        onNewGist={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(screen.getByRole("textbox", { name: "New note name" })).toHaveValue(
      "Recovered context",
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });

  it("does not open the editor when naming is cancelled", async () => {
    const onNewGist = jest.fn();
    render(
      <GistsPanel
        slug="example-project"
        canEdit
        onOpenGist={jest.fn()}
        onNewGist={onNewGist}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New note name" }), {
      target: { value: "Discarded name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onNewGist).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(screen.getByRole("textbox", { name: "New note name" })).toHaveValue("");
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });
});
