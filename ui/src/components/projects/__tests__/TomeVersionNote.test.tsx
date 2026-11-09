/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { TomeVersionNote } from "@/components/projects/TomeVersionNote";

const fetchMock = jest.fn();

function reply(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

describe("TomeVersionNote", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockImplementation(() =>
      reply({
        version: "1.0.0-20260101.1",
        gitCommit: "c249ff5160ab1ac0942edd192ba1ba026ba9f8b9",
        buildDate: "2026-01-01T09:00:00.000Z",
      }),
    );
  });

  it("says nothing until it is asked", async () => {
    render(<TomeVersionNote />);
    expect(
      screen.queryByRole("region", { name: "Version and build information" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Version and build information" }));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Version and build information" }),
      ).toBeInTheDocument(),
    );
  });

  it("reports the release and the whole commit", async () => {
    render(<TomeVersionNote />);
    fireEvent.click(screen.getByRole("button", { name: "Version and build information" }));

    const note = await screen.findByRole("region", {
      name: "Version and build information",
    });
    await waitFor(() =>
      expect(within(note).getByText("1.0.0-20260101.1")).toBeInTheDocument(),
    );
    // Whole, because the reason to read it here is to paste it elsewhere.
    expect(
      within(note).getByText("c249ff5160ab1ac0942edd192ba1ba026ba9f8b9"),
    ).toBeInTheDocument();
  });

  it("stays open under a click elsewhere, and closes from its own cross", async () => {
    render(<TomeVersionNote />);
    fireEvent.click(screen.getByRole("button", { name: "Version and build information" }));
    const note = await screen.findByRole("region", {
      name: "Version and build information",
    });

    // A release is something a reader copies out of here; a panel that went
    // away on the next click could not be copied from.
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(
      screen.getByRole("region", { name: "Version and build information" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(note).getByRole("button", { name: "Close the version information" }),
    );
    expect(
      screen.queryByRole("region", { name: "Version and build information" }),
    ).not.toBeInTheDocument();
  });

  it("leaves out what the build does not report", async () => {
    fetchMock.mockImplementation(() =>
      reply({ version: "dev", gitCommit: "unknown", buildDate: "" }),
    );

    render(<TomeVersionNote />);
    fireEvent.click(screen.getByRole("button", { name: "Version and build information" }));
    const note = await screen.findByRole("region", {
      name: "Version and build information",
    });

    await waitFor(() => expect(within(note).getByText("dev")).toBeInTheDocument());
    // An "unknown" commit is not a commit, and a row saying so is a row
    // worth nobody's time.
    expect(within(note).queryByText("TOME commit")).not.toBeInTheDocument();
    expect(within(note).queryByText("Built")).not.toBeInTheDocument();
  });
});
