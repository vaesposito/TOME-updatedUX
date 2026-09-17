import { findTomeTrackedIssueLabel } from "@/lib/tome/issue-filter-views";

describe("findTomeTrackedIssueLabel", () => {
  const trackers = [
    {
      id: "critical",
      label: "critical",
      title: "Critical",
      aliases: ["tome:critical"],
    },
    {
      id: "security-review",
      label: "security-review",
      title: "Security Review",
    },
  ];

  it("finds duplicate labels case-insensitively", () => {
    expect(findTomeTrackedIssueLabel(trackers, " Security-Review ")).toEqual(trackers[1]);
  });

  it("finds duplicate legacy aliases", () => {
    expect(findTomeTrackedIssueLabel(trackers, "TOME:CRITICAL")).toEqual(trackers[0]);
  });

  it("does not match an untracked label", () => {
    expect(findTomeTrackedIssueLabel(trackers, "release-blocker")).toBeUndefined();
  });
});
