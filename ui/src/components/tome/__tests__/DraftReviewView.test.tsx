/**
 * @jest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DraftReviewView } from "../DraftReviewView";

jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

jest.mock("react-diff-viewer-continued", () => ({
  __esModule: true,
  default: ({ oldValue, newValue }: { oldValue: string; newValue: string }) => (
    <div data-testid="diff">{oldValue} → {newValue}</div>
  ),
  DiffMethod: { WORDS: "WORDS" },
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const response = (body: unknown) => Promise.resolve({
  ok: true,
  status: 200,
  json: async () => body,
} as Response);

describe("DraftReviewView", () => {
  const finalizeCalls = () => (global.fetch as jest.Mock).mock.calls.filter(
    ([url]) => String(url).endsWith("/finalize"),
  );

  function mockEnforcedPolicy(allowOverride: boolean) {
    const original = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/run-example") && !init?.method) {
        return response({ data: {
          status: "awaiting_review",
          quality_evaluation: null,
          quality_policy: { mode: "enforce", version: 1, allow_steward_override: allowOverride },
        } });
      }
      return original(input, init);
    });
  }

  beforeEach(() => {
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/review") && init?.method === "PATCH") {
        return response({ data: { ok: true } });
      }
      if (url.endsWith("/review")) {
        return response({
          data: {
            status: "awaiting_review",
            reviewMode: "stable_only",
            pages: [
              {
                path: "memory.md",
                oldBody: "# Before",
                newBody: "# After",
                isNewPage: false,
                requiresDecision: true,
                decision: null,
                reviewedBy: null,
                reviewedAt: null,
              },
              {
                path: "repos/example/activity.md",
                oldBody: "# Old activity",
                newBody: "# New activity",
                isNewPage: false,
                requiresDecision: false,
                decision: null,
                reviewedBy: null,
                reviewedAt: null,
              },
            ],
          },
        });
      }
      return response({
        data: {
          status: "awaiting_review",
          quality_evaluation: null,
          quality_policy: null,
        },
      });
    }) as jest.Mock;
  });

  it("shows all touched files and explains exactly why finishing is disabled", async () => {
    render(
      <DraftReviewView
        slug="example-project"
        runId="run-example"
        canEdit
      />,
    );

    expect(await screen.findByText("2 changed · 0 of 1 required decisions complete")).toBeInTheDocument();
    expect(screen.getAllByText("memory.md")).toHaveLength(2);
    expect(screen.getByText("repos/example/activity.md")).toBeInTheDocument();
    expect(screen.getByText(/Choose Accept or Reject for 1 remaining file/)).toBeInTheDocument();
    expect(screen.getByText(/already published by the “Stable pages only” policy/)).toBeInTheDocument();

    const finish = screen.getByRole("button", { name: "Finish review" });
    expect(finish).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Accept file" }));
    await waitFor(() => expect(finish).toBeEnabled());
    expect(screen.getByText(/All required decisions are complete/)).toBeInTheDocument();
    fireEvent.click(finish);
    await waitFor(() => expect(finalizeCalls()).toHaveLength(1));
    expect(JSON.parse(finalizeCalls()[0][1].body)).toEqual({});
    await screen.findByText("Changed files");
  });

  it.each(["accept", "reject"])("finishes bulk %s in one click without per-file decisions", async (decision) => {
    const onResolved = jest.fn();
    render(<DraftReviewView slug="example-project" runId="run-example" canEdit onResolved={onResolved} />);
    await screen.findByText("2 changed · 0 of 1 required decisions complete");
    expect(screen.getByRole("button", { name: "Finish review" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: decision === "accept" ? "Accept all" : "Reject all" }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(finalizeCalls()).toHaveLength(1);
    expect(JSON.parse(finalizeCalls()[0][1].body)).toEqual({ decision });
    expect((global.fetch as jest.Mock).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText(decision === "accept" ? "Accepted" : "Rejected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish review" })).not.toBeInTheDocument();
  });

  it("lets bulk rejection replace an individual acceptance", async () => {
    render(<DraftReviewView slug="example-project" runId="run-example" canEdit />);
    await screen.findByText("2 changed · 0 of 1 required decisions complete");
    fireEvent.click(screen.getByRole("button", { name: "Accept file" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject all" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    await screen.findByText("Changed files");
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
  });

  it("blocks bulk accept but permits rejection when the quality gate fails", async () => {
    mockEnforcedPolicy(false);
    render(<DraftReviewView slug="example-project" runId="run-example" canEdit />);
    await screen.findByText("2 changed · 0 of 1 required decisions complete");
    expect(screen.getByRole("button", { name: "Accept all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject all" })).toBeEnabled();
    expect(screen.getByText("Promotion is blocked by the enforced quality policy.")).toBeInTheDocument();
  });

  it("permits entering a quality override before choosing individual files", async () => {
    mockEnforcedPolicy(true);
    render(<DraftReviewView slug="example-project" runId="run-example" canEdit />);
    const reason = await screen.findByLabelText("Required override reason");
    expect(screen.getByRole("button", { name: "Accept all" })).toBeDisabled();
    fireEvent.change(reason, { target: { value: "Source evidence verified by reviewer" } });
    expect(screen.getByRole("button", { name: "Accept all" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    await screen.findByText("Changed files");
    expect(JSON.parse(finalizeCalls()[0][1].body)).toEqual({
      decision: "accept", override_reason: "Source evidence verified by reviewer",
    });
  });

  it("keeps review open and shows the error when bulk finalization fails", async () => {
    const original = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/finalize")) return Promise.resolve({
        ok: false, status: 409, json: async () => ({ error: "Review could not be completed" }),
      } as Response);
      return original(input, init);
    });
    const onResolved = jest.fn();
    render(<DraftReviewView slug="example-project" runId="run-example" canEdit onResolved={onResolved} />);
    await screen.findByText("2 changed · 0 of 1 required decisions complete");
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    await screen.findByText("Review could not be completed");
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Accept all" })).toBeEnabled();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("does not expose bulk actions to read-only viewers", async () => {
    render(<DraftReviewView slug="example-project" runId="run-example" canEdit={false} />);
    await screen.findByText("2 changed · 0 of 1 required decisions complete");
    expect(screen.queryByRole("button", { name: "Accept all" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject all" })).not.toBeInTheDocument();
  });
});
