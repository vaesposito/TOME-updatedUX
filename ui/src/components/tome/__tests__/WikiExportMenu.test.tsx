import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ToastProvider } from "@/components/ui/toast";
import {
  WikiExportMenu,
  wikiExportHref,
} from "@/components/tome/WikiExportMenu";

describe("WikiExportMenu", () => {
  it("builds a page-scoped export URL safely", () => {
    expect(
      wikiExportHref("example project", "markdown", "repos/example/overview.md"),
    ).toBe(
      "/api/tome/projects/example%20project/export?format=markdown&path=repos%2Fexample%2Foverview.md",
    );
  });

  it("shows all formats for the selected page", () => {
    render(
      <ToastProvider>
        <WikiExportMenu slug="example-project" path="roadmap.md" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export this page" }));

    expect(screen.getByText("Export this page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PDF/ })).toHaveAttribute(
      "href",
      "/api/tome/projects/example-project/export?format=pdf&path=roadmap.md",
    );
    expect(screen.queryByRole("link", { name: /PowerPoint/ })).not.toBeInTheDocument();
    for (const label of ["PDF", "HTML", "Markdown"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) }).querySelector("svg"))
        .toBeInTheDocument();
    }
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Experimental")).not.toBeInTheDocument();
  });

  it("shows gist downloads and opens a gist-scoped presentation workflow", () => {
    render(
      <ToastProvider>
        <WikiExportMenu
          slug="example-project"
          gist={{ id: "gist-1", title: "Example gist", filename: "example-gist.md" }}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export this gist" }));
    expect(screen.getByRole("link", { name: /Markdown/ })).toHaveAttribute(
      "href",
      "/api/tome/projects/example-project/export?format=markdown&gist=gist-1",
    );
    expect(screen.queryByRole("link", { name: /PowerPoint/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Export as presentation/ }));
    expect(screen.getByText("Example gist")).toBeInTheDocument();
    expect(screen.getByText("example-gist.md")).toBeInTheDocument();
    expect(screen.queryByText("Entire wiki")).not.toBeInTheDocument();
  });

  it("opens the guided presentation workflow", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          pages: {
            "roadmap.md": "---\ntitle: Roadmap\nkind: stable\n---\nContent",
          },
        },
      }),
    } as Response);
    render(
      <ToastProvider>
        <WikiExportMenu slug="example-project" path="roadmap.md" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export this page" }));
    fireEvent.click(screen.getByRole("button", { name: /Export as presentation/ }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Export as presentation/ })).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Current page")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tome/projects/example-project/pages",
    ));
    fetchMock.mockRestore();
  });

  it("saves through the native picker when the browser supports it", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const createWritable = jest.fn().mockResolvedValue({ close });
    const showSaveFilePicker = jest.fn().mockResolvedValue({ createWritable });
    window.showSaveFilePicker = showSaveFilePicker;
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      body: null,
    } as Response);

    render(
      <ToastProvider>
        <WikiExportMenu slug="example-project" path="roadmap.md" title="Roadmap" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export this page" }));
    fireEvent.click(screen.getByRole("link", { name: /Markdown/ }));

    await waitFor(() => expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "roadmap.md" }),
    ));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tome/projects/example-project/export?format=markdown&path=roadmap.md",
    ));
    await waitFor(() => expect(close).toHaveBeenCalled());

    fetchMock.mockRestore();
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it("cancelling the native picker does not show an error toast", async () => {
    const showSaveFilePicker = jest
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));
    window.showSaveFilePicker = showSaveFilePicker;

    render(
      <ToastProvider>
        <WikiExportMenu slug="example-project" path="roadmap.md" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export this page" }));
    fireEvent.click(screen.getByRole("link", { name: /Markdown/ }));

    await waitFor(() => expect(showSaveFilePicker).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});
