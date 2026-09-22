import { act, renderHook, waitFor } from "@testing-library/react";

import type { WebexCredentialMode } from "@/types/projects";
import { useSourceOptions } from "../useSourceOptions";

function response(label: string) {
  return { json: async () => ({ data: {
    connected: true,
    connectedTo: label,
    manageUrl: "/credentials",
    options: [{ value: label, label }],
  } }) } as Response;
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("useSourceOptions account switching", () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  function setup() {
    return renderHook(({ mode }: { mode: WebexCredentialMode }) =>
      useSourceOptions("webex", {
        webexMode: mode,
        webexCredentialProvider: mode === "managed" ? "webex_messaging" : "webex",
      }), { initialProps: { mode: "personal" as WebexCredentialMode } });
  }

  it("clears rooms and connection metadata immediately and force-refreshes in both directions", async () => {
    const managed = deferredResponse();
    const personal = deferredResponse();
    mockFetch.mockResolvedValueOnce(response("Personal room"))
      .mockReturnValueOnce(managed.promise)
      .mockReturnValueOnce(personal.promise);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.options[0]?.label).toBe("Personal room"));

    rerender({ mode: "managed" });
    expect(result.current).toMatchObject({ options: [], loading: true, connected: false });
    expect(result.current.connectedTo).toBeUndefined();
    expect(mockFetch).toHaveBeenLastCalledWith(expect.stringContaining("webex_mode=managed&credential_provider=webex_messaging&refresh=1"));
    await act(async () => managed.resolve(response("Shared room")));
    expect(result.current.options[0]?.label).toBe("Shared room");

    rerender({ mode: "personal" });
    expect(result.current.options).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(mockFetch).toHaveBeenLastCalledWith(expect.stringContaining("webex_mode=personal&credential_provider=webex&refresh=1"));
    await act(async () => personal.resolve(response("Fresh personal room")));
    expect(result.current.options[0]?.label).toBe("Fresh personal room");
  });

  it("ignores an old in-flight refresh after switching accounts", async () => {
    const stale = deferredResponse();
    mockFetch.mockResolvedValueOnce(response("Personal room"))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(response("Shared room"));
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.reload());
    rerender({ mode: "managed" });
    await waitFor(() => expect(result.current.options[0]?.label).toBe("Shared room"));
    await act(async () => stale.resolve(response("Stale personal room")));
    expect(result.current.options[0]?.label).toBe("Shared room");
  });

  it("does not reuse rooms when switching back before the new account has loaded", async () => {
    const managed = deferredResponse();
    const personal = deferredResponse();
    mockFetch.mockResolvedValueOnce(response("Old personal room"))
      .mockReturnValueOnce(managed.promise)
      .mockReturnValueOnce(personal.promise);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ mode: "managed" });
    rerender({ mode: "personal" });
    expect(result.current.options).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(async () => managed.resolve(response("Stale shared room")));
    expect(result.current.options).toEqual([]);
    await act(async () => personal.resolve(response("Fresh personal room")));
    expect(result.current.options[0]?.label).toBe("Fresh personal room");
  });

  it("cancels a pending search when switching accounts", async () => {
    mockFetch.mockResolvedValue(response("Room"));
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    jest.useFakeTimers();
    act(() => result.current.search("old account query"));
    rerender({ mode: "managed" });
    await act(async () => { jest.advanceTimersByTime(350); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes("q="))).toBe(false);
  });

  it("does not restore old rooms when the new account request fails", async () => {
    mockFetch.mockResolvedValueOnce(response("Personal room"))
      .mockRejectedValueOnce(new Error("network unavailable"));
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ mode: "managed" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options).toEqual([]);
    expect(result.current.connectedTo).toBeUndefined();
  });
});
