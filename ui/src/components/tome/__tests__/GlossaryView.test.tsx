/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GlossaryView } from "@/components/tome/GlossaryView";

const TERMS = [
  {
    path: "glossary/bhag.md",
    term: "BHAG",
    expansion: "Big Hairy Audacious Goal",
    aliases: ["Big Goal"],
    scope: "org",
    termKind: "acronym",
    status: "current",
    definition: "A goal large enough to organise several years of work around.",
  },
  {
    path: "glossary/slo.md",
    term: "SLO",
    expansion: "Service Level Objective",
    aliases: [],
    scope: "project",
    termKind: "acronym",
    status: "deprecated",
    definition: "The reliability a service promises.",
  },
];

function answer(terms: unknown[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { terms } }),
  }) as unknown as typeof fetch;
}

describe("GlossaryView", () => {
  it("reads the term, what it stands for and what it means", async () => {
    answer(TERMS);
    render(<GlossaryView slug="example-project" onOpenPage={() => {}} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "BHAG" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Big Hairy Audacious Goal")).toBeInTheDocument();
    expect(
      screen.getByText(/A goal large enough to organise/),
    ).toBeInTheDocument();
    expect(screen.getByText("Also called Big Goal")).toBeInTheDocument();
  });

  it("marks a term that has been retired, and one that reaches past this space", async () => {
    answer(TERMS);
    render(<GlossaryView slug="example-project" onOpenPage={() => {}} />);

    await waitFor(() => expect(screen.getByText("Deprecated")).toBeInTheDocument());
    expect(screen.getByText("Organisation")).toBeInTheDocument();
    // A project-scoped term in a project's own glossary says nothing, so it
    // is left unsaid.
    expect(screen.queryByText("project")).not.toBeInTheDocument();
  });

  it("says how many words the space has", async () => {
    answer(TERMS);
    render(<GlossaryView slug="example-project" onOpenPage={() => {}} />);

    await waitFor(() => expect(screen.getByText("2 terms")).toBeInTheDocument());
  });

  it("finds a term by its expansion, not only by the word", async () => {
    answer(TERMS);
    render(<GlossaryView slug="example-project" onOpenPage={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Find a term")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Find a term"), {
      target: { value: "service level" },
    });

    expect(screen.getByRole("button", { name: "SLO" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "BHAG" })).not.toBeInTheDocument();
  });

  it("opens the term's own page, where it can be edited", async () => {
    answer(TERMS);
    const opened: string[] = [];
    render(
      <GlossaryView slug="example-project" onOpenPage={(path) => opened.push(path)} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "SLO" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "SLO" }));

    expect(opened).toEqual(["glossary/slo.md"]);
  });

  it("says what fills a glossary rather than showing an empty list", async () => {
    answer([]);
    render(<GlossaryView slug="example-project" onOpenPage={() => {}} />);

    await waitFor(() => expect(screen.getByText("No terms yet")).toBeInTheDocument());
    // No search box over nothing.
    expect(screen.queryByLabelText("Find a term")).not.toBeInTheDocument();
  });

  it("says so when the glossary cannot be read", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    render(<GlossaryView slug="example-project" onOpenPage={() => {}} />);

    await waitFor(() =>
      expect(
        screen.getByText("Could not load this space's glossary."),
      ).toBeInTheDocument(),
    );
  });
});
