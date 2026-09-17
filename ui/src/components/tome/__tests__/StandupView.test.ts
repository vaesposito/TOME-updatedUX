import { parseStandup, summarizeStandupHeadline } from "@/lib/tome/standup";

describe("parseStandup", () => {
  it("preserves structured headings and Markdown lists", () => {
    const parsed = parseStandup(`---
title: The Standup
kind: report
---
## What is this

Project summary.

## Headline

Release is ready.

## Progress

- Completed release validation
- Closed the launch checklist

## Asks / Blockers

- Need approval
- Need access

## Up next

- Deploy
`);
    expect(parsed.headline).toBe("Release is ready.");
    expect(parsed.progress).toBe(
      "- Completed release validation\n- Closed the launch checklist",
    );
    expect(parsed.blockers).toBe("- Need approval\n- Need access");
    expect(parsed.upNext).toBe("- Deploy");
    expect(parsed.fallback).toBe("");
  });

  it("recovers bold run-on section labels into separate sections", () => {
    const parsed = parseStandup(
      "**What is this** Project summary. **Headline:** Release ready. " +
        "**Since last update** - Validation passed " +
        "**Asks / Blockers** - Need approval **Up next** - Deploy",
    );
    expect(parsed.whatIsThis).toBe("Project summary.");
    expect(parsed.headline).toBe("Release ready.");
    expect(parsed.progress).toBe("- Validation passed");
    expect(parsed.blockers).toBe("- Need approval");
    expect(parsed.upNext).toBe("- Deploy");
  });

  it("falls back to block Markdown when no report headings are present", () => {
    const parsed = parseStandup("- First workstream\n- Second workstream");
    expect(parsed.fallback).toBe("- First workstream\n- Second workstream");
  });

  it("keeps legacy structured standups valid when progress is absent", () => {
    const parsed = parseStandup(`## Headline

Delivery is on track.

## Blockers

- None

## Up next

- Ship the release`);

    expect(parsed.progress).toBe("");
    expect(parsed.blockers).toBe("- None");
    expect(parsed.fallback).toBe("");
  });
});

describe("summarizeStandupHeadline", () => {
  it("keeps a concise headline unchanged", () => {
    expect(summarizeStandupHeadline("The release is ready for production."))
      .toBe("The release is ready for production.");
  });

  it("extracts the first meaningful sentence from a legacy report", () => {
    expect(
      summarizeStandupHeadline(
        "**v1.0.0 shipped:** The release is now generally available. " +
          "Major follow-up work started immediately. More details follow.",
      ),
    ).toBe("v1.0.0 shipped: The release is now generally available.");
  });

  it("keeps only the plain-language takeaway from a formatted report", () => {
    expect(
      summarizeStandupHeadline(
        "**Go Live Aug 4: All three projects shipping. Security blockers " +
          "must resolve before deadline.** CAIPE releases remain stable.",
      ),
    ).toBe("Go Live Aug 4: All three projects shipping.");
  });

  it("bounds a legacy headline without sentence punctuation", () => {
    const summarized = summarizeStandupHeadline("update ".repeat(60));
    expect(summarized.endsWith("…")).toBe(true);
    expect(summarized.length).toBeLessThanOrEqual(121);
  });
});
