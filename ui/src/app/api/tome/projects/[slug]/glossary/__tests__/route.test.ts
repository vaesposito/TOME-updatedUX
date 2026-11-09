/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockListPages = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  successResponse: (data: unknown) => Response.json({ data }),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));

jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: async () => ({ listPages: mockListPages }),
}));

import { GET } from "../route";

const ctx = { params: Promise.resolve({ slug: "example-project" }) };

/** Read the terms out of the route's response. */
async function terms(pages: Record<string, string>) {
  mockListPages.mockResolvedValue(pages);
  const response = await GET(
    new NextRequest("http://localhost/api/tome/projects/example-project/glossary"),
    ctx,
  );
  const body = await response.json();
  return body.data.terms as Record<string, unknown>[];
}

describe("GET a project's glossary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({ projectId: "project-1" });
  });

  it("reads a term out of its frontmatter", async () => {
    const found = await terms({
      "glossary/slo.md": [
        "---",
        "type: glossary",
        "term: SLO",
        "expansion: Service Level Objective",
        "term_kind: acronym",
        "scope: org",
        "status: current",
        "aliases:",
        "  - Service Objective",
        "---",
        "The reliability a service promises.",
      ].join("\n"),
    });

    expect(found).toEqual([
      {
        path: "glossary/slo.md",
        term: "SLO",
        expansion: "Service Level Objective",
        aliases: ["Service Objective"],
        scope: "org",
        termKind: "acronym",
        status: "current",
        definition: "The reliability a service promises.",
      },
    ]);
  });

  it("leaves out everything that is not a term", async () => {
    const found = await terms({
      "charter.md": "---\ntitle: Charter\n---\nWhat we are for.",
      "glossary/slo.md": "---\ntype: glossary\nterm: SLO\n---\nA promise.",
    });

    expect(found.map((term) => term.term)).toEqual(["SLO"]);
  });

  it("keeps a term filed outside the folder, and skips a note filed inside it", async () => {
    const found = await terms({
      "decisions/naming.md": "---\ntype: glossary\nterm: Space\n---\nA project.",
      "glossary/readme.md": "---\ntitle: How this works\n---\nNot a term.",
    });

    // Typed by its frontmatter, not by where it sits.
    expect(found.map((term) => term.term)).toEqual(["Space"]);
  });

  it("reads them in the order a glossary is read", async () => {
    const found = await terms({
      "glossary/slo.md": "---\ntype: glossary\nterm: SLO\n---\n",
      "glossary/area.md": "---\ntype: glossary\nterm: area\n---\n",
      "glossary/bhag.md": "---\ntype: glossary\nterm: BHAG\n---\n",
    });

    // Alphabetical and case-blind: a lower-case term is not a later one.
    expect(found.map((term) => term.term)).toEqual(["area", "BHAG", "SLO"]);
  });

  it("falls back to the filename rather than leaving a term unnamed", async () => {
    const found = await terms({
      "glossary/pull-request.md": "---\ntype: glossary\n---\nA proposed change.",
    });

    expect(found[0].term).toBe("pull-request");
  });

  it("takes aliases written on one line as readily as a list", async () => {
    const found = await terms({
      "glossary/slo.md":
        "---\ntype: glossary\nterm: SLO\naliases: Service Objective, Objective\n---\n",
    });

    expect(found[0].aliases).toEqual(["Service Objective", "Objective"]);
  });

  it("says nothing rather than empty strings for what a term omits", async () => {
    const found = await terms({
      "glossary/slo.md": "---\ntype: glossary\nterm: SLO\n---\n",
    });

    expect(found[0]).toMatchObject({
      expansion: null,
      scope: null,
      termKind: null,
      status: null,
      aliases: [],
      definition: "",
    });
  });
});
