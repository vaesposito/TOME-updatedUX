/** Native TOME SSE translated into GRID's shared chat callbacks and timeline. */
import type { StreamAdapter } from "../adapter";
import type { StreamCallbacks, StreamParams } from "../callbacks";
import { parseSSEStream } from "../parse-sse";
import { buildStreamErrorFromResponse } from "../stream-error";

export class TomeStreamAdapter implements StreamAdapter {
  private controller: AbortController | null = null;

  abort(): void { this.controller?.abort(); }

  async cancelStream(): Promise<boolean> {
    this.abort();
    return true;
  }

  async resumeStream(): Promise<void> {
    throw new Error("Native TOME does not use dynamic-agent approval forms.");
  }

  async streamMessage(params: StreamParams, callbacks: StreamCallbacks): Promise<void> {
    if (params.files?.length) throw new Error("Open a project's native chat to attach files.");
    this.controller = new AbortController();
    try {
      const response = await fetch("/api/tome/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message: params.message, conversation_id: params.conversationId,
          ...(typeof params.forwardedProps?.verify_sources === "boolean" ? { verify_sources: params.forwardedProps.verify_sources } : {}) }),
        signal: this.controller.signal,
      });
      if (!response.ok) throw await buildStreamErrorFromResponse(response);
      let completed = false;
      for await (const frame of parseSSEStream(response)) {
        const data = JSON.parse(frame.data) as Record<string, unknown>;
        let type = frame.event;
        let normalized: Record<string, unknown> = data;
        if (type === "token") {
          type = "content";
          normalized = { text: String(data.text ?? ""), namespace: [] };
          callbacks.onContent?.(String(data.text ?? ""), []);
        } else if (type === "tool_call") {
          type = "tool_start";
          normalized = { tool_call_id: data.id, tool_name: data.tool, args: data.input, namespace: [] };
          callbacks.onToolStart?.(String(data.id ?? ""), String(data.tool ?? "tool"), data.input as Record<string, unknown>, []);
        } else if (type === "tool_result") {
          type = "tool_end";
          const error = data.is_error === true ? String(data.preview ?? "TOME read failed") : undefined;
          normalized = { tool_call_id: data.id, result: data.preview, error, namespace: [] };
          callbacks.onToolEnd?.(String(data.id ?? ""), undefined, error, [], undefined, String(data.preview ?? ""));
        } else if (type === "error") {
          completed = true;
          normalized = { error: String(data.message ?? "TOME execution failed") };
          callbacks.onError?.(String(normalized.error));
        } else if (type === "done") {
          completed = true;
          callbacks.onDone?.();
        }
        callbacks.onRawEvent?.({ type, data: normalized, timestamp: Date.now() });
        if (completed) break;
      }
      if (!completed) throw new Error("TOME stream ended before completing the answer.");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) throw error;
    } finally {
      this.controller = null;
    }
  }
}
