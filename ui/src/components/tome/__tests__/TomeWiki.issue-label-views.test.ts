import {
  customTomeTrackerLabel,
  isTomeTrackedIssueLabel,
  materializeTomeIssueLabels,
  matchesTomeTrackedIssueLabel,
  type TomeIssueLabelSettings,
  TOME_TRACKED_ISSUE_LABELS,
} from "@/lib/tome/issue-filter-views";

describe("TOME tracked issue labels", () => {
  it("uses unprefixed default labels", () => {
    expect(TOME_TRACKED_ISSUE_LABELS).toEqual([
      { id: "critical", label: "critical", title: "Critical" },
      { id: "needs-attention", label: "needs attention", title: "Needs Attention" },
      { id: "decision", label: "decision", title: "Decisions" },
    ]);
  });

  it("does not treat arbitrary GitHub labels as tracked", () => {
    expect(isTomeTrackedIssueLabel("TOME:CRITICAL")).toBe(false);
    expect(isTomeTrackedIssueLabel("critical")).toBe(true);
    expect(isTomeTrackedIssueLabel("bug")).toBe(false);
  });

  it("uses unprefixed custom tracker labels", () => {
    expect(customTomeTrackerLabel("security-review")).toBe("security-review");
    expect(customTomeTrackerLabel("tome:security-review")).toBeNull();
    expect(customTomeTrackerLabel("security review")).toBeNull();
  });

  it("materializes configurable labels with or without the prefix", () => {
    const settings: TomeIssueLabelSettings = {
      labels: {
        critical: { title: "Urgent", suffix: "urgent" },
        "needs-attention": { title: "Follow Up", suffix: "follow-up" },
        decision: { title: "Decision Records", suffix: "decision-record" },
      },
    };

    expect(materializeTomeIssueLabels(settings)).toEqual([
      { id: "critical", label: "urgent", title: "Urgent" },
      { id: "needs-attention", label: "follow-up", title: "Follow Up" },
      { id: "decision", label: "decision-record", title: "Decision Records" },
    ]);
  });

  it("omits disabled optional labels", () => {
    expect(materializeTomeIssueLabels({
      labels: {
        critical: { title: "Critical", suffix: "critical", enabled: false },
        "needs-attention": { title: "Needs Attention", suffix: "needs attention" },
        decision: { title: "Decisions", suffix: "decision" },
      },
    })).toEqual([
      { id: "needs-attention", label: "needs attention", title: "Needs Attention" },
      { id: "decision", label: "decision", title: "Decisions" },
    ]);
  });

  it("matches a configured label's legacy alias", () => {
    expect(matchesTomeTrackedIssueLabel(["tome:critical"], {
      id: "critical",
      label: "urgent",
      title: "Urgent",
      aliases: ["tome:critical"],
    })).toBe(true);
  });
});
