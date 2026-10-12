import { mentionMarkdown } from "@/lib/tome/mentions";

describe("mentionMarkdown", () => {
  it("writes a name as a contactable link", () => {
    expect(mentionMarkdown({ email: "reviewer@example.com", name: "Ada Reviewer" })).toBe(
      "[@Ada Reviewer](mailto:reviewer@example.com)",
    );
  });

  it("falls back to the address when there is no name", () => {
    expect(mentionMarkdown({ email: "reviewer@example.com" })).toBe(
      "[@reviewer@example.com](mailto:reviewer@example.com)",
    );
  });

  // A bracket in a display name would otherwise end the link text early and
  // leave the rest of the name loose in the page.
  it("strips brackets out of a display name", () => {
    expect(
      mentionMarkdown({ email: "reviewer@example.com", name: "Ada [Reviewer]" }),
    ).toBe("[@Ada Reviewer](mailto:reviewer@example.com)");
  });

  // A parenthesis in the target would close the link and let whatever follows
  // become a second link in the page, so it is dropped rather than carried
  // through. The visible label is harmless either way.
  it("drops characters that would break out of the link target", () => {
    const markdown = mentionMarkdown({
      email: "reviewer@example.com) [x](http://elsewhere",
    });

    expect(markdown).toContain("(mailto:reviewer@example.comxhttp://elsewhere)");
    // Exactly one link, with nothing in the target that could end it early.
    expect(markdown).toMatch(/^\[@[^[\]]*\]\(mailto:[^()[\]\s]*\)$/);
  });

  it("still produces a usable label when the name is only brackets", () => {
    expect(mentionMarkdown({ email: "reviewer@example.com", name: "[]" })).toBe(
      "[@reviewer@example.com](mailto:reviewer@example.com)",
    );
  });
});
