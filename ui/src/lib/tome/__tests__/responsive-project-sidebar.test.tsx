import { act, renderHook } from "@testing-library/react";

import {
  TOME_COMPACT_LAYOUT_QUERY,
  useResponsiveProjectSidebar,
} from "@/lib/tome/responsive-project-sidebar";

describe("useResponsiveProjectSidebar", () => {
  let compact = false;
  let listeners: Set<() => void>;

  beforeEach(() => {
    compact = false;
    listeners = new Set();
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      get matches() {
        return compact;
      },
      media: query,
      addEventListener: (_event: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) =>
        listeners.delete(listener),
    }));
  });

  it("starts open on desktop and can be toggled", () => {
    const { result } = renderHook(() => useResponsiveProjectSidebar());

    expect(window.matchMedia).toHaveBeenCalledWith(TOME_COMPACT_LAYOUT_QUERY);
    expect(result.current.open).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it("starts closed on compact screens and closes after navigation", () => {
    compact = true;
    const { result } = renderHook(() => useResponsiveProjectSidebar());

    expect(result.current.open).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);

    act(() => result.current.closeOnCompact());
    expect(result.current.open).toBe(false);
  });

  it("uses the natural sidebar default when the viewport crosses the breakpoint", () => {
    const { result } = renderHook(() => useResponsiveProjectSidebar());
    expect(result.current.open).toBe(true);

    act(() => {
      compact = true;
      listeners.forEach((listener) => listener());
    });
    expect(result.current.open).toBe(false);

    act(() => {
      compact = false;
      listeners.forEach((listener) => listener());
    });
    expect(result.current.open).toBe(true);
  });
});
