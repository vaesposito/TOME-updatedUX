/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ToastProvider } from "@/components/ui/toast";
import { IssueLabelsTab } from "../IssueLabelsTab";

const settings = {
  _id: "global",
  labels: {
    critical: { title: "Critical", suffix: "critical", enabled: true },
    "needs-attention": { title: "Needs Attention", suffix: "needs attention", enabled: true },
    decision: { title: "Decisions", suffix: "decision", enabled: true },
  },
  version: 1,
  updated_at: null,
  updated_by: null,
};

const jsonResponse = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => ({ data }),
} as Response);

describe("IssueLabelsTab", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(settings));
  });

  it("removes an optional label and can restore it before saving", async () => {
    render(
      <ToastProvider>
        <IssueLabelsTab />
      </ToastProvider>,
    );

    expect(await screen.findByDisplayValue("critical")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Critical label" }));

    expect(screen.queryByDisplayValue("critical")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Critical" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const [, init] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      labels: { critical: { enabled: false } },
    });
  });
});
