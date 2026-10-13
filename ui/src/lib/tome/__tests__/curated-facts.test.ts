import {
  milestoneStatus,
  parseCharterKpis,
  parseRoadmapMilestones,
  upcomingMilestones,
  type RoadmapMilestone,
} from "@/lib/tome/curated-facts";
import { STABLE_SEED_BODIES } from "@/lib/tome/schema";

const ROADMAP = [
  "## Intent",
  "Ship the platform.",
  "",
  "## Milestones",
  "_The dated outcomes that define progress._",
  "",
  "| Milestone | Target (Qtr / Month) | Outcome & Success Signal | MM/MS | Owner | Status |",
  "| --- | --- | --- | --- | --- | --- |",
  "| Public beta | Q2 FY26 | 50 teams onboarded | MM | Platform Guild | In progress - ETA Jul'26 |",
  "| General availability | Q4 FY26 | Support rota in place | MS | [Dana Okafor](mailto:dana@example.com) | Not started |",
  "| Design partner pilot | Q1 FY26 | Three partners signed | MM | Platform Guild | Done |",
  "",
  "## Delivery Plan",
  "| Deliverable | Workstream | Target Date |",
  "| --- | --- | --- |",
  "| Billing API | Platform | Jul'26 |",
].join("\n");

describe("parseRoadmapMilestones", () => {
  it("reads every column of a milestone row", () => {
    const [first] = parseRoadmapMilestones(ROADMAP);
    expect(first).toEqual({
      title: "Public beta",
      target: "Q2 FY26",
      outcome: "50 teams onboarded",
      delivery: "MM",
      owner: "Platform Guild",
      status: "in_progress",
      statusLabel: "In progress - ETA Jul'26",
    });
  });

  it("keeps the page's own order", () => {
    expect(parseRoadmapMilestones(ROADMAP).map((m) => m.title)).toEqual([
      "Public beta",
      "General availability",
      "Design partner pilot",
    ]);
  });

  it("shows a linked owner by name", () => {
    expect(parseRoadmapMilestones(ROADMAP)[1].owner).toBe("Dana Okafor");
  });

  it("reads the Milestones table, not the Delivery Plan below it", () => {
    expect(parseRoadmapMilestones(ROADMAP)).toHaveLength(3);
  });

  it("returns nothing for a roadmap with no Milestones section", () => {
    expect(parseRoadmapMilestones("## Intent\nShip it.")).toEqual([]);
  });

  it("returns nothing for a page that is not a roadmap at all", () => {
    expect(parseRoadmapMilestones("")).toEqual([]);
  });

  it("drops a row that was never named", () => {
    const partial = [
      "## Milestones",
      "| Milestone | Owner |",
      "| --- | --- |",
      "|  | Platform Guild |",
      "| Public beta |  |",
    ].join("\n");
    expect(parseRoadmapMilestones(partial).map((m) => m.title)).toEqual([
      "Public beta",
    ]);
  });

  it("finds nothing in the untouched template, which ships empty", () => {
    expect(parseRoadmapMilestones(STABLE_SEED_BODIES["roadmap.md"])).toEqual([]);
  });

  it("reads the template's own columns once rows are filled in", () => {
    const filled = STABLE_SEED_BODIES["roadmap.md"].replace(
      "|  |  |  |  |  |  |",
      "| Public beta | Q2 FY26 | 50 teams | MM | Platform Guild | Blocked |",
    );
    expect(parseRoadmapMilestones(filled)).toEqual([
      {
        title: "Public beta",
        target: "Q2 FY26",
        outcome: "50 teams",
        delivery: "MM",
        owner: "Platform Guild",
        status: "blocked",
        statusLabel: "Blocked",
      },
    ]);
  });
});

describe("milestoneStatus", () => {
  it.each([
    ["Not started", "not_started"],
    ["In progress", "in_progress"],
    ["In-progress", "in_progress"],
    ["In progress - ETA Jul'26", "in_progress"],
    ["At risk", "at_risk"],
    ["Blocked on review", "blocked"],
    ["Done", "done"],
    ["Shipped", "done"],
    ["**Done**", "done"],
  ])("reads %s as %s", (cell, expected) => {
    expect(milestoneStatus(cell)).toBe(expected);
  });

  it("does not guess at a status it has no word for", () => {
    expect(milestoneStatus("Waiting on the vendor")).toBe("unknown");
    expect(milestoneStatus("")).toBe("unknown");
  });
});

describe("upcomingMilestones", () => {
  const milestone = (
    title: string,
    status: RoadmapMilestone["status"],
  ): RoadmapMilestone => ({
    title,
    target: "",
    outcome: "",
    delivery: "",
    owner: "",
    status,
    statusLabel: "",
  });

  it("puts what has not landed first, each group in its own order", () => {
    const all = [
      milestone("shipped", "done"),
      milestone("building", "in_progress"),
      milestone("planned", "not_started"),
    ];
    expect(upcomingMilestones(all, 3).map((m) => m.title)).toEqual([
      "building",
      "planned",
      "shipped",
    ]);
  });

  it("falls back to finished ones so a delivered project still shows a record", () => {
    const all = [milestone("first", "done"), milestone("second", "done")];
    expect(upcomingMilestones(all, 1).map((m) => m.title)).toEqual(["first"]);
  });

  it("stops at the limit", () => {
    const all = [
      milestone("a", "in_progress"),
      milestone("b", "in_progress"),
      milestone("c", "in_progress"),
    ];
    expect(upcomingMilestones(all, 2)).toHaveLength(2);
  });
});

describe("parseCharterKpis", () => {
  const CHARTER = [
    "## Goals",
    "Win.",
    "",
    "## KPIs",
    "| Metric | Baseline | Target | Time frame |",
    "| --- | --- | --- | --- |",
    "| Weekly active teams | 12 | 80 | Q4 FY26 |",
    "| Time to first page | 3 days | 1 hour | Q2 FY26 |",
  ].join("\n");

  it("reads every column of a KPI row", () => {
    expect(parseCharterKpis(CHARTER)[0]).toEqual({
      metric: "Weekly active teams",
      baseline: "12",
      target: "80",
      timeframe: "Q4 FY26",
    });
  });

  it("reads each KPI the table lists", () => {
    expect(parseCharterKpis(CHARTER).map((k) => k.metric)).toEqual([
      "Weekly active teams",
      "Time to first page",
    ]);
  });

  it("keeps a metric that has no target agreed yet", () => {
    const partial = [
      "## KPIs",
      "| Metric | Baseline | Target | Time frame |",
      "| --- | --- | --- | --- |",
      "| Weekly active teams |  |  |  |",
    ].join("\n");
    expect(parseCharterKpis(partial)).toEqual([
      { metric: "Weekly active teams", baseline: "", target: "", timeframe: "" },
    ]);
  });

  it("finds nothing in the untouched template, which ships empty", () => {
    expect(parseCharterKpis(STABLE_SEED_BODIES["charter.md"])).toEqual([]);
  });

  it("returns nothing for a charter with no KPIs section", () => {
    expect(parseCharterKpis("## Goals\nWin.")).toEqual([]);
  });
});
