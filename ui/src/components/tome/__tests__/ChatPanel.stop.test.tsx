import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TextDecoder, TextEncoder } from "node:util";
import { ReadableStream } from "node:stream/web";
import type { ReactNode } from "react";

import { useTomeChatStore } from "@/store/tome-chat-store";
import { ChatPanel } from "../ChatPanel";

Object.assign(global, { TextDecoder, TextEncoder, ReadableStream });

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/components/chat/AuditNotice", () => ({
  AuditNotice: () => <span>Audit notice</span>,
}));

jest.mock("@/components/chat/MessageActions", () => ({
  MessageActions: () => null,
}));

jest.mock("@/components/shared/timeline", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const SESSION_ID = "00000000-0000-4000-8000-000000000001";

describe("ChatPanel stop", () => {
  beforeEach(() => {
    useTomeChatStore.getState().reset();
    jest.clearAllMocks();
  });

  it("frees the composer immediately and stops the run server-side", async () => {
    const encoder = new TextEncoder();
    let chatSignal: AbortSignal | undefined;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/chat/history") && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            data: { session: null, messages: [], readOnly: false, sessionOwner: null },
          }),
        } as Response;
      }
      if (url.endsWith("/chat") && init?.method === "POST") {
        chatSignal = init.signal ?? undefined;
        let sentPartial = false;
        return {
          ok: true,
          headers: new Headers({ "X-Tome-Session-Id": SESSION_ID, "X-Tome-Run-Id": "run-1" }),
          body: {
            getReader: () => ({
              read: () => {
                if (!sentPartial) {
                  sentPartial = true;
                  return Promise.resolve({
                    done: false,
                    value: encoder.encode('event: token\ndata: {"text":"Partial answer"}\n\n'),
                  });
                }
                // Hang like a stuck upstream until the browser aborts.
                return new Promise((_resolve, reject) => {
                  chatSignal?.addEventListener("abort", () =>
                    reject(new DOMException("aborted", "AbortError")),
                  );
                });
              },
            }),
          },
        } as unknown as Response;
      }
      if (url.endsWith("/chat/runs/run-1") && init?.method === "DELETE") {
        return { ok: true, json: async () => ({ data: { stopped: true } }) } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;

    render(<ChatPanel slug="example-project" />);
    const composer = await screen.findByPlaceholderText("Ask about this project…");
    fireEvent.change(composer, { target: { value: "Summarize this project" } });
    fireEvent.click(screen.getByTitle("Send"));

    expect(await screen.findByText(/Partial answer/)).toBeInTheDocument();
    const stop = await screen.findByRole("button", { name: "Stop" });
    await waitFor(() => expect(stop).toBeEnabled());

    fireEvent.click(stop);

    await waitFor(() => {
      expect(useTomeChatStore.getState().chats["example-project:active"]?.streaming).toBe(false);
    });
    expect(chatSignal?.aborted).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tome/projects/example-project/chat/runs/run-1",
      { method: "DELETE" },
    );
    expect(screen.getByText(/Stopped\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();

    fireEvent.change(composer, { target: { value: "Next question" } });
    expect(screen.getByTitle("Send")).toBeEnabled();
  });

  it("lets the user stop a hung run the chat reattached to on load", async () => {
    let replaySignal: AbortSignal | undefined;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/chat/history")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              session: { id: SESSION_ID, sdkSessionId: null, userId: "test-user@example.com" },
              messages: [{ role: "user", content: "Summarize this project" }],
              activeRun: { id: "run-1", sessionId: SESSION_ID },
              readOnly: false,
              sessionOwner: "test-user@example.com",
            },
          }),
        } as Response;
      }
      if (url.endsWith("/chat/runs/run-1") && init?.method === "DELETE") {
        return { ok: true, json: async () => ({ data: { stopped: true } }) } as Response;
      }
      if (url.endsWith("/chat/runs/run-1")) {
        replaySignal = init?.signal ?? undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            replaySignal?.addEventListener("abort", () =>
              controller.error(new DOMException("aborted", "AbortError")),
            );
          },
        });
        return { ok: true, body: stream } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;

    render(<ChatPanel slug="example-project" />);
    const stop = await screen.findByRole("button", { name: "Stop" });
    await waitFor(() => expect(replaySignal).toBeDefined());

    fireEvent.click(stop);

    await waitFor(() => {
      const chat = useTomeChatStore.getState().chats["example-project:active"];
      expect(chat?.streaming).toBe(false);
      expect(chat?.resumeRunId).toBeNull();
    });
    expect(replaySignal?.aborted).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tome/projects/example-project/chat/runs/run-1",
      { method: "DELETE" },
    );
    expect(screen.getByPlaceholderText("Ask about this project…")).toBeEnabled();
  });
});
