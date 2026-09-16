import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TomeMediaInsertDialog } from "../TomeMediaInsertDialog";

const PLAYLIST_ID = "daa5d80c-9272-4587-989b-91d6c5f35b93";

describe("TomeMediaInsertDialog", () => {
  it("explains how to insert a regular link without a preview", () => {
    render(
      <TomeMediaInsertDialog
        open
        onOpenChange={jest.fn()}
        onInsert={jest.fn()}
      />,
    );

    expect(screen.getByText(/paste it directly into the document instead/i)).toBeVisible();
  });

  it("exposes and persists the Vidcast playlist expansion preference", () => {
    const onInsert = jest.fn();
    render(
      <TomeMediaInsertDialog
        open
        onOpenChange={jest.fn()}
        onInsert={onInsert}
      />,
    );

    fireEvent.change(screen.getByLabelText("Video or playlist URL"), {
      target: { value: `https://app.vidcast.io/playlists/${PLAYLIST_ID}` },
    });

    const toggle = screen.getByRole("switch", { name: "Show playlist videos" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));

    expect(onInsert).toHaveBeenCalledWith(
      `\n\n\`\`\`vidcast\nurl: https://app.vidcast.io/playlists/${PLAYLIST_ID}?expand=0\n\`\`\`\n\n`,
    );
  });

  it("uploads an Excalidraw file and inserts its JSON as a fenced block", async () => {
    const onInsert = jest.fn();
    render(
      <TomeMediaInsertDialog
        open
        onOpenChange={jest.fn()}
        onInsert={onInsert}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Excalidraw" }));
    const file = new File(
      [
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [{ id: "shape-1", type: "rectangle", x: 0, y: 0 }],
          appState: {},
          files: {},
        }),
      ],
      "architecture.excalidraw",
      { type: "application/json" },
    );

    fireEvent.change(screen.getByLabelText("Excalidraw drawing file"), {
      target: { files: [file] },
    });
    await screen.findByText(/Ready to insert architecture\.excalidraw/i);
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));

    expect(onInsert).toHaveBeenCalledTimes(1);
    const markdown = onInsert.mock.calls[0][0] as string;
    expect(markdown).toMatch(/^\n\n```excalidraw\n/);
    expect(markdown).toContain('"type": "excalidraw"');
    expect(markdown).toContain('"id": "shape-1"');
    expect(markdown).toMatch(/\n```\n\n$/);
  });

  it("rejects a mislabeled Excalidraw upload", async () => {
    const onInsert = jest.fn();
    render(
      <TomeMediaInsertDialog
        open
        onOpenChange={jest.fn()}
        onInsert={onInsert}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Excalidraw" }));
    fireEvent.change(screen.getByLabelText("Excalidraw drawing file"), {
      target: {
        files: [
          new File(["{}"], "architecture.json", { type: "application/json" }),
        ],
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/\.excalidraw/i);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled(),
    );
    expect(onInsert).not.toHaveBeenCalled();
  });
});
