import {
  cellText,
  column,
  parseMarkdownTable,
  sectionBody,
  tableUnder,
} from "@/lib/tome/markdown-tables";

describe("parseMarkdownTable", () => {
  it("reads the headings and rows of a pipe table", () => {
    const table = parseMarkdownTable(
      ["| Metric | Target |", "| --- | --- |", "| Adoption | 80% |"].join("\n"),
    );
    expect(table).toEqual({
      headers: ["Metric", "Target"],
      rows: [["Adoption", "80%"]],
    });
  });

  it("reads a table written without outer pipes", () => {
    const table = parseMarkdownTable(
      ["Metric | Target", "--- | ---", "Adoption | 80%"].join("\n"),
    );
    expect(table?.headers).toEqual(["Metric", "Target"]);
    expect(table?.rows).toEqual([["Adoption", "80%"]]);
  });

  it("accepts the alignment colons a separator may carry", () => {
    const table = parseMarkdownTable(
      ["| Metric | Target |", "|:--- | ---:|", "| Adoption | 80% |"].join("\n"),
    );
    expect(table?.rows).toEqual([["Adoption", "80%"]]);
  });

  it("drops the blank row the page templates ship", () => {
    const table = parseMarkdownTable(
      ["| Metric | Target |", "| --- | --- |", "|  |  |"].join("\n"),
    );
    expect(table?.headers).toHaveLength(2);
    expect(table?.rows).toEqual([]);
  });

  it("keeps a row whose first cell alone is empty", () => {
    const table = parseMarkdownTable(
      ["| Metric | Target |", "| --- | --- |", "| | 80% |"].join("\n"),
    );
    expect(table?.rows).toEqual([["", "80%"]]);
  });

  it("keeps an escaped pipe as content rather than a column break", () => {
    const table = parseMarkdownTable(
      ["| Metric | Target |", "| --- | --- |", String.raw`| p95 \| p99 | 80% |`].join("\n"),
    );
    expect(table?.rows).toEqual([["p95 | p99", "80%"]]);
  });

  it("skips the prose and comments above a table", () => {
    const table = parseMarkdownTable(
      [
        "_Some guidance for whoever fills this in._",
        "<!-- Sourced from the charter. -->",
        "",
        "| Metric | Target |",
        "| --- | --- |",
        "| Adoption | 80% |",
      ].join("\n"),
    );
    expect(table?.rows).toEqual([["Adoption", "80%"]]);
  });

  it("stops at the first line that is not a row", () => {
    const table = parseMarkdownTable(
      [
        "| Metric | Target |",
        "| --- | --- |",
        "| Adoption | 80% |",
        "",
        "Some closing prose.",
      ].join("\n"),
    );
    expect(table?.rows).toEqual([["Adoption", "80%"]]);
  });

  it("returns null when there is no table", () => {
    expect(parseMarkdownTable("Just a sentence about the roadmap.")).toBeNull();
  });

  it("returns null for a heading row with no separator under it", () => {
    expect(parseMarkdownTable("| Metric | Target |\n| Adoption | 80% |")).toBeNull();
  });
});

describe("sectionBody", () => {
  const page = [
    "---",
    "title: Roadmap",
    "---",
    "## Intent",
    "What this covers.",
    "",
    "## Milestones",
    "| Milestone |",
    "| --- |",
    "| Launch |",
    "",
    "## Progress Summary",
    "On track.",
  ].join("\n");

  it("returns one section without the ones around it", () => {
    expect(sectionBody(page, "Milestones")).toBe(
      "| Milestone |\n| --- |\n| Launch |",
    );
  });

  it("finds a section whatever case it is asked for in", () => {
    expect(sectionBody(page, "milestones")).toContain("Launch");
  });

  it("runs the last section to the end of the page", () => {
    expect(sectionBody(page, "Progress Summary")).toBe("On track.");
  });

  it("returns nothing for a section the page does not have", () => {
    expect(sectionBody(page, "Dependencies")).toBe("");
  });

  it("ignores a heading that only appears in the frontmatter", () => {
    const framed = ["---", "title: '## Milestones'", "---", "Body text."].join("\n");
    expect(sectionBody(framed, "Milestones")).toBe("");
  });
});

describe("tableUnder", () => {
  it("returns null when the section exists but holds no table", () => {
    expect(tableUnder("## Milestones\nNone yet.", "Milestones")).toBeNull();
  });
});

describe("cellText", () => {
  it("shows a linked owner as the name a reader sees", () => {
    expect(cellText("[Dana Okafor](mailto:dana@example.com)")).toBe("Dana Okafor");
  });

  it("drops emphasis and collapses the space around a line break", () => {
    expect(cellText("**At risk**<br/>  waiting on review")).toBe(
      "At risk waiting on review",
    );
  });
});

describe("column", () => {
  const table = {
    headers: ["Milestone", "Target (Qtr / Month)", "Owner"],
    rows: [["Launch", "Q2 FY26", "Platform Guild"]],
  };

  it("ignores the guidance a heading carries in brackets", () => {
    expect(column(table, table.rows[0], "target")).toBe("Q2 FY26");
  });

  it("falls back through the names a column may go by", () => {
    expect(column(table, table.rows[0], "deliverable", "milestone")).toBe("Launch");
  });

  it("returns nothing when no name matches, rather than the wrong column", () => {
    expect(column(table, table.rows[0], "status")).toBe("");
  });

  it("returns nothing for a column the row stopped short of", () => {
    expect(column(table, ["Launch"], "owner")).toBe("");
  });
});
