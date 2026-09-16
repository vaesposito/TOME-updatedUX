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
  });
});
