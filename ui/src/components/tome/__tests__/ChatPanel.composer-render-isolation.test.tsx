import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextDecoder, TextEncoder } from "node:util";
import type { ReactNode } from "react";

import { useTomeChatStore } from "@/store/tome-chat-store";
import { ChatPanel } from "../ChatPanel";

Object.assign(global, { TextDecoder, TextEncoder });

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/components/chat/AuditNotice", () => ({
  AuditNotice: () => <span>Audit notice</span>,
}));

// Not memoized itself — used here as a render-count probe for each
// MessageRow. If a composer keystroke ever re-renders the message list
// again (#655), this mock's call count will move.
const messageActionsSpy = jest.fn(() => null);
jest.mock("@/components/chat/MessageActions", () => ({
  MessageActions: (...args: unknown[]) => messageActionsSpy(...args),
}));

jest.mock("@/components/shared/timeline", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("ChatPanel composer render isolation", () => {
  beforeEach(() => {
    useTomeChatStore.getState().reset();
    jest.clearAllMocks();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/chat/history")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              session: null,
              messages: [
                { role: "user", content: "Hello" },
                { role: "assistant", content: "Hi there" },
              ],
              readOnly: false,
              sessionOwner: null,
            },
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;
  });

  it("does not re-render the message list while the user types", async () => {
    render(<ChatPanel slug="example-project" />);

    await screen.findByText("Hi there");
    const composer = await screen.findByPlaceholderText("Ask about this project…");

    const callsBeforeTyping = messageActionsSpy.mock.calls.length;
    expect(callsBeforeTyping).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.type(composer, "Does this lag?");

    await waitFor(() => expect(composer).toHaveValue("Does this lag?"));
    expect(messageActionsSpy.mock.calls.length).toBe(callsBeforeTyping);
  });
});
