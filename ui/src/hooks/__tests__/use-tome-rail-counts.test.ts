import { renderHook, waitFor } from "@testing-library/react";

import { useTomeRailCounts } from "../use-tome-rail-counts";

const fetchMock = jest.fn();

function reply(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

describe("useTomeRailCounts", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("counts the notes, the issues and the meetings behind their rows", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("github-issues")
        ? reply({ data: { issues: [{ id: 1 }, { id: 2 }, { id: 3 }] } })
        : url.includes("webex-meeting-series")
          ? reply({ data: { subscriptions: [{ id: "s1" }, { id: "s2" }] } })
          : reply({ data: { gists: [{ id: "a" }] } }),
    );

    const { result } = renderHook(() =>
      useTomeRailCounts("example-project", { issues: true }),
    );

    // Both in one wait: the two reads land independently, and asserting them
    // one after the other lets the second settle outside the first's wait.
    await waitFor(() => {
      expect(result.current.notes).toBe(1);
      expect(result.current.issues).toBe(3);
      expect(result.current.meetings).toBe(2);
    });
  });

  it("reports nought for a space with none of them, rather than nothing", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("github-issues")
        ? reply({ data: { issues: [] } })
        : url.includes("webex-meeting-series")
          ? reply({ data: { subscriptions: [] } })
          : reply({ data: { gists: [] } }),
    );

    const { result } = renderHook(() =>
      useTomeRailCounts("example-project", { issues: true }),
    );

    await waitFor(() => {
      expect(result.current.notes).toBe(0);
      expect(result.current.issues).toBe(0);
      expect(result.current.meetings).toBe(0);
    });
  });

  it("leaves a count unknown rather than guessing it when the read fails", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("github-issues")
        ? Promise.reject(new Error("offline"))
        : reply(null, false),
    );

    const { result } = renderHook(() =>
      useTomeRailCounts("example-project", { issues: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(result.current.notes).toBeUndefined();
    expect(result.current.issues).toBeUndefined();
    expect(result.current.meetings).toBeUndefined();
  });

  it("does not reach GitHub for a rail with no Issues row", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("webex-meeting-series")
        ? reply({ data: { subscriptions: [] } })
        : reply({ data: { gists: [] } }),
    );

    const { result } = renderHook(() =>
      useTomeRailCounts("example-project", { issues: false }),
    );

    await waitFor(() => expect(result.current.notes).toBe(0));
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("github-issues")),
    ).toBe(false);
  });

  it("drops the last space's figures on the way to the next", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("first-example-project")
        ? reply({ data: { gists: [{ id: "a" }, { id: "b" }] } })
        : new Promise(() => {}),
    );

    const { result, rerender } = renderHook(
      ({ slug }) => useTomeRailCounts(slug, { issues: false }),
      { initialProps: { slug: "first-example-project" } },
    );

    await waitFor(() => expect(result.current.notes).toBe(2));

    // Two notes belong to the space just left, and showing them against the
    // next one's row would be a count of the wrong place.
    rerender({ slug: "second-example-project" });
    expect(result.current.notes).toBeUndefined();
  });
});
