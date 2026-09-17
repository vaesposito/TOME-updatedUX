"use client";

import { useCallback, useSyncExternalStore } from "react";

const DISCLOSURE_PREFERENCE_EVENT = "tome-disclosure-preference-change";

/** Keep a disclosure preference in sync within this tab and across browser tabs. */
export function usePersistentDisclosure(
  storageKey: string,
  defaultExpanded = true,
): readonly [boolean, (expanded: boolean) => void] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey) onStoreChange();
      };
      const onLocalChange = (event: Event) => {
        if ((event as CustomEvent<string>).detail === storageKey) {
          onStoreChange();
        }
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(DISCLOSURE_PREFERENCE_EVENT, onLocalChange);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(DISCLOSURE_PREFERENCE_EVENT, onLocalChange);
      };
    },
    [storageKey],
  );
  const getSnapshot = useCallback(() => {
    const stored = window.localStorage.getItem(storageKey);
    return stored === null ? defaultExpanded : stored === "true";
  }, [defaultExpanded, storageKey]);
  const expanded = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultExpanded,
  );
  const setExpanded = useCallback(
    (nextExpanded: boolean) => {
      window.localStorage.setItem(storageKey, String(nextExpanded));
      window.dispatchEvent(
        new CustomEvent(DISCLOSURE_PREFERENCE_EVENT, { detail: storageKey }),
      );
    },
    [storageKey],
  );

  return [expanded, setExpanded] as const;
}
