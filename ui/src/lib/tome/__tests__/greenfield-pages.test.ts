/**
 * What a new space is founded with.
 *
 * One page a reader meets, written by the agent and editable by hand. The
 * seven-page scaffold this replaced opened every new space on a shelf of
 * blank documents, so the count here is the point of the test, not an
 * incidental detail of it.
 */

jest.mock("../page-store", () => ({ getPageStore: jest.fn() }));
jest.mock("../page-templates-store", () => ({ getPageTemplate: jest.fn() }));

import { DEFAULT_PAGES } from "../schema";
import { getPageTemplate } from "../page-templates-store";
import { buildGreenfieldPages } from "../seed";

const template = getPageTemplate as jest.MockedFunction<typeof getPageTemplate>;

/** The default template, as the store would hand it back. */
function defaultTemplate() {
  return {
    _id: "top-level" as const,
    scope: "top-level" as const,
    pages: DEFAULT_PAGES.map((spec) => ({
      ...spec,
      enabled: true,
      ...(spec.path === "overview.md"
        ? { body: "<!--\nGuidance for the ingest agent\n-->\n" }
        : {}),
    })),
    version: 1,
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: null,
  };
}

describe("the default page template", () => {
  it("shows one page and hides the agent's own notes", () => {
    const shown = DEFAULT_PAGES.filter((spec) => spec.kind !== "hidden");
    expect(shown.map((spec) => spec.path)).toEqual(["overview.md"]);
    expect(shown[0].kind).toBe("dynamic");
    expect(DEFAULT_PAGES.map((spec) => spec.path)).toContain("memory.md");
  });
});

describe("founding a wiki", () => {
  beforeEach(() => {
    template.mockResolvedValue(defaultTemplate());
  });

  it("writes the one page, and the memory behind it", async () => {
    const pages = await buildGreenfieldPages("");
    expect(Object.keys(pages).sort()).toEqual(["memory.md", "overview.md"]);
  });

  it("leads the overview with what the space says about itself", async () => {
    const pages = await buildGreenfieldPages("  Keeps the billing pipeline  ");

    const [, frontmatter, body] = pages["overview.md"].split("---\n");
    expect(frontmatter).toContain("kind: dynamic");
    // Trimmed, first, and above the agent's guidance rather than inside it.
    expect(body.trimStart().startsWith("Keeps the billing pipeline")).toBe(true);
    expect(body).toContain("Guidance for the ingest agent");
  });

  it("leaves the page to the agent when nothing was written about the space", async () => {
    const pages = await buildGreenfieldPages("   ");
    expect(pages["overview.md"]).not.toContain("undefined");
    expect(pages["overview.md"]).toContain("Guidance for the ingest agent");
  });
});
