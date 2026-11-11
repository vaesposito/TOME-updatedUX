/**
 * @jest-environment jsdom
 *
 * The catalogue's welcome band offers Send feedback next to Connect via MCP:
 * both at the band's one size, and the feedback button opening the product
 * feedback dialog TOME already has rather than a second path of its own.
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { McpConnectDialog } from "../McpConnectDialog";
import { TomeProductFeedback } from "../TomeProductFeedback";

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => {
    switch (key) {
      case "reportProblemEnabled":
      case "ticketEnabled":
        return true;
      case "githubTicketRepo":
        return "example-org/example-repo";
      default:
        return null;
    }
  },
}));

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { email: "test-user@example.com" },
      accessToken: "test-token",
    },
  }),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/projects",
}));

/** The pair as the welcome band renders it, in the band's own row. */
function WelcomeBandActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <McpConnectDialog />
      <TomeProductFeedback variant="link" />
    </div>
  );
}

describe("TOME welcome band feedback action", () => {
  it("stands beside Connect via MCP at the band's size", () => {
    render(<WelcomeBandActions />);

    const mcp = screen.getByRole("button", { name: /connect via mcp/i });
    const feedback = screen.getByRole("button", { name: /send feedback/i });

    expect(feedback.parentElement).toBe(mcp.parentElement);
    expect(mcp.compareDocumentPosition(feedback)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    for (const shape of ["h-9", "gap-1.5", "rounded-lg", "px-3", "text-sm"]) {
      expect(mcp).toHaveClass(shape);
      expect(feedback).toHaveClass(shape);
    }
  });

  it("opens the product feedback dialog TOME already has", () => {
    render(<WelcomeBandActions />);

    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Provide Feedback");
    expect(
      screen.getByRole("button", { name: /submit github issue/i }),
    ).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
