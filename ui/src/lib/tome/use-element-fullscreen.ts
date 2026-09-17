"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

type WebKitFullscreenDocument = Document & {
  webkitCancelFullScreen?: () => Promise<void> | void;
  webkitCurrentFullScreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type WebKitFullscreenElement = HTMLElement & {
  webkitRequestFullScreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function getFullscreenElement(doc: Document): Element | null {
  const webkitDocument = doc as WebKitFullscreenDocument;
  return (
    doc.fullscreenElement ??
    webkitDocument.webkitFullscreenElement ??
    webkitDocument.webkitCurrentFullScreenElement ??
    null
  );
}

async function requestElementFullscreen(element: HTMLElement): Promise<boolean> {
  const webkitElement = element as WebKitFullscreenElement;
  const request =
    element.requestFullscreen ??
    webkitElement.webkitRequestFullscreen ??
    webkitElement.webkitRequestFullScreen;

  if (!request) return false;

  try {
    await request.call(element);
    return true;
  } catch {
    return false;
  }
}

async function exitDocumentFullscreen(doc: Document): Promise<boolean> {
  const webkitDocument = doc as WebKitFullscreenDocument;
  const exit =
    doc.exitFullscreen ??
    webkitDocument.webkitExitFullscreen ??
    webkitDocument.webkitCancelFullScreen;

  if (!exit) return false;

  try {
    await exit.call(doc);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drives native element fullscreen when the browser supports it. Safari
 * versions that only expose the WebKit API use its prefixed methods/events;
 * browsers that reject element fullscreen fall back to a viewport overlay.
 */
export function useElementFullscreen(targetRef: RefObject<HTMLElement | null>) {
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isFallbackFullscreen, setIsFallbackFullscreen] = useState(false);

  useEffect(() => {
    const syncNativeState = () => {
      setIsNativeFullscreen(getFullscreenElement(document) === targetRef.current);
    };

    document.addEventListener("fullscreenchange", syncNativeState);
    document.addEventListener("webkitfullscreenchange", syncNativeState);
    syncNativeState();

    return () => {
      document.removeEventListener("fullscreenchange", syncNativeState);
      document.removeEventListener("webkitfullscreenchange", syncNativeState);
    };
  }, [targetRef]);

  useEffect(() => {
    if (!isFallbackFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFallbackFullscreen(false);
    };
    document.addEventListener("keydown", exitOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", exitOnEscape);
    };
  }, [isFallbackFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    if (isFallbackFullscreen) {
      setIsFallbackFullscreen(false);
      return;
    }

    if (getFullscreenElement(document)) {
      await exitDocumentFullscreen(document);
      return;
    }

    const target = targetRef.current;
    if (!target) return;

    const enteredNativeFullscreen = await requestElementFullscreen(target);
    if (enteredNativeFullscreen) {
      setIsNativeFullscreen(true);
    } else {
      setIsFallbackFullscreen(true);
    }
  }, [isFallbackFullscreen, targetRef]);

  return {
    isFallbackFullscreen,
    isFullscreen: isNativeFullscreen || isFallbackFullscreen,
    toggleFullscreen,
  };
}
