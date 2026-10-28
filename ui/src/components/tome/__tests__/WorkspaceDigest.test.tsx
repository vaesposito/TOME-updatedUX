/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import * as React from "react";

import { WorkspaceDigest } from "@/components/tome/WorkspaceDigest";

describe("WorkspaceDigest", () => {
  it("lays out the week: when it was written, the gist, then the sections", () => {
    render(<WorkspaceDigest />);
    expect(screen.getByText("Digest")).toBeInTheDocument();
    expect(screen.getByText("Thursday, Oct 15")).toBeInTheDocument();
    expect(
      screen.getByText("Written 10:26 AM, covers since Oct 8"),
    ).toBeInTheDocument();
    expect(screen.getByText("Needs a person")).toBeInTheDocument();
    expect(screen.getByText("What moved")).toBeInTheDocument();
  });

  it("offers the things a reader does with one", () => {
    render(<WorkspaceDigest />);
    for (const name of [
      "Configure digest",
      "Share this digest",
      "Copy this digest",
      "Write it again",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("admits that none of it is real yet", () => {
    // The layout is here to be argued with before anything writes into it, so
    // it has to say that rather than let a reader act on invented spaces.
    render(<WorkspaceDigest />);
    expect(
      screen.getByText(/Nothing above is drawn from your spaces yet/),
    ).toBeInTheDocument();
  });

  it("reads nothing, so it cannot show one space's week as every space's", () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<WorkspaceDigest />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
