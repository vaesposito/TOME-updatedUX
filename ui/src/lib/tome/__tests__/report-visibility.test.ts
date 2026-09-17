import {
  DEFAULT_TOME_REPORT_VISIBILITY,
  resolveTomeReportVisibility,
} from "../report-visibility";

describe("resolveTomeReportVisibility", () => {
  it("keeps reports visible for projects created before the setting existed", () => {
    expect(resolveTomeReportVisibility(undefined)).toEqual(
      DEFAULT_TOME_REPORT_VISIBILITY,
    );
  });

  it("respects explicit hidden reports while defaulting missing fields to visible", () => {
    expect(
      resolveTomeReportVisibility({
        report_visibility: { standup: false },
      }),
    ).toEqual({
      enabled: true,
      standup: false,
      issues: true,
    });
  });
});
