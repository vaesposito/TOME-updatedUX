/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useTomeViewTracking } from "../usage-tracking";

it("records successful rendered navigation once without counting loading or polling", () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  global.fetch = fetchMock;
  const { rerender } = renderHook(
    ({ ready, path }) => useTomeViewTracking("primary", "page", path, ready),
    { initialProps: { ready: false, path: "overview.md" } },
  );
  expect(fetchMock).not.toHaveBeenCalled();
  rerender({ ready: true, path: "overview.md" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const event = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(event).toMatchObject({ viewKind: "page", pagePath: "overview.md" });
  expect(event.analyticsSessionId).toBeTruthy();
  rerender({ ready: false, path: "overview.md" });
  rerender({ ready: true, path: "overview.md" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  rerender({ ready: false, path: "missing.md" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  rerender({ ready: true, path: "architecture.md" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).analyticsSessionId).toBe(
    event.analyticsSessionId,
  );
});
