import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";

import { useElementFullscreen } from "@/lib/tome/use-element-fullscreen";

type TestFullscreenDocument = Document & {
  webkitExitFullscreen?: jest.Mock;
  webkitFullscreenElement?: Element | null;
};

type TestFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: jest.Mock;
};

describe("useElementFullscreen", () => {
  let target: TestFullscreenElement;
  let targetRef: RefObject<HTMLElement | null>;

  beforeEach(() => {
    target = document.createElement("div") as TestFullscreenElement;
    targetRef = { current: target };
    document.body.appendChild(target);
  });

  afterEach(() => {
    target.remove();
    document.body.style.overflow = "";
    delete (document as Partial<Document>).fullscreenElement;
    delete (document as Partial<Document>).exitFullscreen;
    delete (document as TestFullscreenDocument).webkitFullscreenElement;
    delete (document as TestFullscreenDocument).webkitExitFullscreen;
  });

  it("keeps the standard fullscreen path working", async () => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    target.requestFullscreen = jest.fn(async () => {
      fullscreenElement = target;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    document.exitFullscreen = jest.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    const { result } = renderHook(() => useElementFullscreen(targetRef));

    await act(async () => result.current.toggleFullscreen());
    expect(target.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isFullscreen).toBe(true);

    await act(async () => result.current.toggleFullscreen());
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isFullscreen).toBe(false);
  });

  it("uses Safari's prefixed fullscreen methods and change event", async () => {
    const safariDocument = document as TestFullscreenDocument;
    safariDocument.webkitFullscreenElement = null;
    target.webkitRequestFullscreen = jest.fn(() => {
      safariDocument.webkitFullscreenElement = target;
      document.dispatchEvent(new Event("webkitfullscreenchange"));
    });
    safariDocument.webkitExitFullscreen = jest.fn(() => {
      safariDocument.webkitFullscreenElement = null;
      document.dispatchEvent(new Event("webkitfullscreenchange"));
    });

    const { result } = renderHook(() => useElementFullscreen(targetRef));

    await act(async () => result.current.toggleFullscreen());
    expect(target.webkitRequestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isFullscreen).toBe(true);
    expect(result.current.isFallbackFullscreen).toBe(false);

    await act(async () => result.current.toggleFullscreen());
    expect(safariDocument.webkitExitFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isFullscreen).toBe(false);
  });

  it("uses a viewport fallback when element fullscreen is unavailable", async () => {
    const { result } = renderHook(() => useElementFullscreen(targetRef));

    await act(async () => result.current.toggleFullscreen());
    expect(result.current.isFullscreen).toBe(true);
    expect(result.current.isFallbackFullscreen).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(result.current.isFullscreen).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("falls back when Safari rejects an element fullscreen request", async () => {
    target.webkitRequestFullscreen = jest.fn().mockRejectedValue(new Error("Not supported"));

    const { result } = renderHook(() => useElementFullscreen(targetRef));

    await act(async () => result.current.toggleFullscreen());
    expect(result.current.isFullscreen).toBe(true);
    expect(result.current.isFallbackFullscreen).toBe(true);

    await act(async () => result.current.toggleFullscreen());
    expect(result.current.isFullscreen).toBe(false);
  });
});
