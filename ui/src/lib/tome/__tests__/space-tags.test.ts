import {
  describeSpaceTag,
  frontmatterSpaceTags,
  pageSpaceTags,
  parseSpaceTagHref,
  preserveStoredSpaceTags,
  spaceTagMarkdown,
  withFrontmatterSpaceTags,
  withSpaceTags,
} from "@/lib/tome/space-tags";
import { parseFrontmatter, serializeFrontmatter, type FrontmatterValue } from "@/lib/tome/schema";

/** What the editor does to a page when someone tags it and saves. */
function save(markdown: string, slugs: string[]): string {
  const [fm, body] = parseFrontmatter(markdown);
  return serializeFrontmatter(
    withFrontmatterSpaceTags(fm as Record<string, FrontmatterValue>, slugs),
    body,
  );
}

describe("spaceTagMarkdown", () => {
  it("writes a space as a followable link", () => {
    expect(spaceTagMarkdown({ slug: "example-project", title: "Example Project" })).toBe(
      "[#Example Project](/projects/example-project/tome)",
    );
  });

  it("falls back to the slug when there is no title", () => {
    expect(spaceTagMarkdown({ slug: "example-project" })).toBe(
      "[#example-project](/projects/example-project/tome)",
    );
  });

  // A bracket in a space's name would otherwise end the link text early and
  // leave the rest of the name loose in the page.
  it("strips brackets out of a space name", () => {
    expect(
      spaceTagMarkdown({ slug: "example-project", title: "Example [Project]" }),
    ).toBe("[#Example Project](/projects/example-project/tome)");
  });
});

describe("parseSpaceTagHref", () => {
  it("reads the space out of a tag", () => {
    expect(parseSpaceTagHref("/projects/example-project/tome")).toBe("example-project");
  });

  // A link to a page inside a space says "see that page", not "this content
  // belongs to that space", and must not become a row in its related content.
  it("is not a tag when the link points at a page inside the space", () => {
    expect(parseSpaceTagHref("/projects/example-project/tome/wiki/charter.md")).toBeNull();
  });

  it("is not a tag when the link leaves the product", () => {
    expect(parseSpaceTagHref("https://example.com/projects/example-project/tome")).toBeNull();
  });
});

describe("pageSpaceTags", () => {
  it("reads a whole-page tag out of frontmatter", () => {
    const tags = pageSpaceTags(
      "---\ntitle: Notes\ntagged_spaces: [example-project]\n---\nSome prose.",
    );

    expect(tags.slugs).toEqual(["example-project"]);
    expect(tags.bySlug["example-project"]).toEqual({ page: true, passages: 0 });
  });

  // Agent-authored frontmatter is plain YAML, where a block list is the
  // ordinary way to write an array.
  it("reads a block-list tag the agent would have written", () => {
    const tags = pageSpaceTags(
      "---\ntitle: Notes\ntagged_spaces:\n  - example-project\n  - other-space\n---\nProse.",
    );

    expect(tags.slugs).toEqual(["example-project", "other-space"]);
  });

  it("counts the passages that tag a space", () => {
    const tags = pageSpaceTags(
      [
        "---",
        "title: Meeting notes",
        "---",
        "The migration work sits in [#Example Project](/projects/example-project/tome).",
        "",
        "Rollout is owned by [#Example Project](/projects/example-project/tome) too.",
      ].join("\n"),
    );

    expect(tags.slugs).toEqual(["example-project"]);
    expect(tags.bySlug["example-project"]).toEqual({ page: false, passages: 2 });
  });

  it("keeps both granularities apart on the same page", () => {
    const tags = pageSpaceTags(
      [
        "---",
        "tagged_spaces: [example-project]",
        "---",
        "See [#Other Space](/projects/other-space/tome) for the rest.",
      ].join("\n"),
    );

    expect(tags.bySlug["example-project"]).toEqual({ page: true, passages: 0 });
    expect(tags.bySlug["other-space"]).toEqual({ page: false, passages: 1 });
  });

  it("ignores a link to a page inside another space", () => {
    const tags = pageSpaceTags(
      "---\ntitle: Notes\n---\nSee [the charter](/projects/example-project/tome/wiki/charter.md).",
    );

    expect(tags.slugs).toEqual([]);
  });

  it("finds nothing on an untagged page", () => {
    expect(pageSpaceTags("---\ntitle: Charter\n---\nNothing here.").slugs).toEqual([]);
  });
});

describe("tagging a page and saving it", () => {
  // The round trip that matters: a tag is data, so it has to come back out of
  // the markdown the editor wrote, not just out of the component that set it.
  it("survives a save and a reload", () => {
    const saved = save("---\ntitle: Notes\nkind: stable\n---\nProse.", ["example-project"]);

    expect(saved).toContain("tagged_spaces: [example-project]");
    expect(pageSpaceTags(saved).slugs).toEqual(["example-project"]);
    // The rest of the page is untouched.
    const [fm, body] = parseFrontmatter(saved);
    expect(fm.title).toBe("Notes");
    expect(fm.kind).toBe("stable");
    expect(body.trim()).toBe("Prose.");
  });

  it("survives a save on a page that had no frontmatter at all", () => {
    const saved = save("Just prose.", ["example-project"]);

    expect(pageSpaceTags(saved).slugs).toEqual(["example-project"]);
    expect(parseFrontmatter(saved)[1].trim()).toBe("Just prose.");
  });

  it("removes the key entirely when the last tag is taken off", () => {
    const tagged = save("---\ntitle: Notes\n---\nProse.", ["example-project"]);
    const untagged = save(tagged, []);

    expect(untagged).not.toContain("tagged_spaces");
    expect(pageSpaceTags(untagged).slugs).toEqual([]);
  });

  it("refuses a tag that could not name a space", () => {
    expect(
      frontmatterSpaceTags(withFrontmatterSpaceTags({}, ["../elsewhere", "example-project"])),
    ).toEqual(["example-project"]);
  });

  it("stores a space only once however many times it is added", () => {
    expect(
      frontmatterSpaceTags(
        withFrontmatterSpaceTags({}, ["example-project", "example-project"]),
      ),
    ).toEqual(["example-project"]);
  });
});

describe("withSpaceTags", () => {
  it("rewrites the key without disturbing the rest of the frontmatter", () => {
    const out = withSpaceTags(
      "---\ntitle: Notes\ntagged_spaces: [old-space]\nkind: dynamic\n---\nProse.",
      ["example-project"],
    );

    expect(out).toBe(
      "---\ntitle: Notes\ntagged_spaces: [example-project]\nkind: dynamic\n---\nProse.",
    );
  });

  it("replaces a block list rather than leaving it beside the new value", () => {
    const out = withSpaceTags(
      "---\ntitle: Notes\ntagged_spaces:\n  - old-space\n  - older-space\nkind: dynamic\n---\nProse.",
      ["example-project"],
    );

    expect(out).toBe(
      "---\ntitle: Notes\ntagged_spaces: [example-project]\nkind: dynamic\n---\nProse.",
    );
  });
});

describe("preserveStoredSpaceTags", () => {
  // The silent-data-loss case: an ingest regenerates a dynamic page's body and
  // composes fresh frontmatter with it, so without this every tag on a dynamic
  // page would be dropped on the next run.
  it("carries a stored tag across an agent rewrite that dropped it", () => {
    const result = preserveStoredSpaceTags(
      "---\ntitle: Activity\nkind: dynamic\ntagged_spaces: [example-project]\n---\nOld body.",
      "---\ntitle: Activity\nkind: dynamic\n---\nRegenerated body.",
    );

    expect(result.restored).toEqual(["example-project"]);
    expect(pageSpaceTags(result.markdown).slugs).toEqual(["example-project"]);
    expect(parseFrontmatter(result.markdown)[1].trim()).toBe("Regenerated body.");
  });

  it("lets the agent add a tag of its own alongside the stored one", () => {
    const result = preserveStoredSpaceTags(
      "---\ntagged_spaces: [example-project]\n---\nOld body.",
      "---\ntagged_spaces: [other-space]\n---\nNew body.",
    );

    expect(pageSpaceTags(result.markdown).slugs).toEqual(["other-space", "example-project"]);
  });

  it("leaves a write alone when nothing was dropped", () => {
    const incoming = "---\ntagged_spaces: [example-project]\n---\nNew body.";
    const result = preserveStoredSpaceTags(
      "---\ntagged_spaces: [example-project]\n---\nOld body.",
      incoming,
    );

    expect(result.markdown).toBe(incoming);
    expect(result.restored).toEqual([]);
  });

  it("leaves a page the agent is creating alone", () => {
    const incoming = "---\ntitle: New\n---\nBody.";
    expect(preserveStoredSpaceTags(null, incoming).markdown).toBe(incoming);
  });

  // In-body tags are part of the prose. When the prose is regenerated the
  // passage they annotated no longer exists, so there is nothing to carry.
  it("does not resurrect a passage tag out of a replaced body", () => {
    const result = preserveStoredSpaceTags(
      "---\ntitle: Activity\n---\nOwned by [#Example](/projects/example-project/tome).",
      "---\ntitle: Activity\n---\nRegenerated body.",
    );

    expect(pageSpaceTags(result.markdown).slugs).toEqual([]);
  });
});

describe("describeSpaceTag", () => {
  it("says how a page claims a space", () => {
    expect(describeSpaceTag({ page: true, passages: 0 })).toBe("Whole page");
    expect(describeSpaceTag({ page: false, passages: 1 })).toBe("1 passage");
    expect(describeSpaceTag({ page: false, passages: 3 })).toBe("3 passages");
    expect(describeSpaceTag({ page: true, passages: 2 })).toBe("Whole page · 2 passages");
  });
});
