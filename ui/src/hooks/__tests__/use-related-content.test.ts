/** @jest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";

import { useRelatedContent } from "@/hooks/use-related-content";

/** The tagged-content endpoint, as the route answers it. */
function answers(items: unknown[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { items } }),
  }) as unknown as typeof fetch;
}

describe("useRelatedContent", () => {
  it("names each page and the space it lives in", async () => {
    answers([
      {
        space_slug: "other-space",
        space_title: "Other Space",
        path: "notes/kickoff.md",
        title: "Kickoff notes",
        whole_page: true,
        passages: 0,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const { result } = renderHook(() => useRelatedContent("example-project"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.related).toEqual([
      {
        spaceSlug: "other-space",
        spaceTitle: "Other Space",
        path: "notes/kickoff.md",
        title: "Kickoff notes",
        wholePage: true,
        passages: 0,
      },
    ]);
  });

  it("asks the space being read, not the catalogue", async () => {
    answers([]);

    renderHook(() => useRelatedContent("example project"));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tome/projects/example%20project/tagged-content",
      { cache: "no-store" },
    );
  });

  it("finds nothing for a space no page has tagged", async () => {
    answers([]);

    const { result } = renderHook(() => useRelatedContent("example-project"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.related).toEqual([]);
  });

  // An unreachable index is an empty list rather than a broken rail: the
  // reader is told nothing has tagged this space, which is also what they
  // would be told if nothing had.
  it("stays empty when the index cannot be read", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    const { result } = renderHook(() => useRelatedContent("example-project"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.related).toEqual([]);
  });

  it("drops a row the route could not name a page for", async () => {
    answers([{ space_slug: "other-space", title: "Nameless" }]);

    const { result } = renderHook(() => useRelatedContent("example-project"));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.related).toEqual([]);
  });
});
