import { wikiPageHref, wikiPagePathFromHref } from "@/lib/tome/wiki-page-href";

/**
 * These two are the only link between a notification and the page it is
 * about, which is what puts a dot in the wiki tree. Nothing else enforces
 * that they agree, so the round trip is tested rather than each half.
 */
describe("wiki page links", () => {
  it.each([
    "charter.md",
    "demos/gateway-migration-walkthrough.md",
    "a/b/c/deeply-nested.md",
    "notes/quarterly review.md",
    "notes/costs-&-risks.md",
    "décisions/résumé.md",
  ])("round-trips %s", (path) => {
    expect(wikiPagePathFromHref(wikiPageHref("example-project", path))).toBe(path);
  });

  it("survives a slug that needs escaping", () => {
    const href = wikiPageHref("example project", "charter.md");
    expect(wikiPagePathFromHref(href)).toBe("charter.md");
  });

  it("ignores a fragment or query the reader's link may carry", () => {
    const href = `${wikiPageHref("example-project", "charter.md")}?v=2#section`;
    expect(wikiPagePathFromHref(href)).toBe("charter.md");
  });

  it.each([
    ["the entity landing page", "/projects/example-project/tome"],
    ["the wiki root", "/projects/example-project/tome/wiki"],
    ["another pane", "/projects/example-project/tome/agent"],
    ["somewhere else entirely", "/notifications"],
    ["an off-site link", "https://example.com/projects/x/tome/wiki/page.md"],
    ["a malformed escape", "/projects/example-project/tome/wiki/%E0%A4%A"],
  ])("returns null for %s", (_label, href) => {
    expect(wikiPagePathFromHref(href)).toBeNull();
  });
});
