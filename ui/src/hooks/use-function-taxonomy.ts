"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  defaultTaxonomy,
  normaliseTaxonomy,
  type FunctionTaxonomy,
} from "@/lib/projects/function-taxonomy";

/**
 * The function taxonomy, as this browser holds it.
 *
 * Kept on the device rather than on the server, because nothing stores it
 * server-side yet. That is a real limit and the hook does not hide it: what
 * one person makes here is theirs until the taxonomy moves behind an API, at
 * which point only this file and its key have to change.
 *
 * Read as an external store rather than copied into state after mount. The
 * device's copy is exactly that — something outside React that changes
 * without React's knowledge, including from another tab — and subscribing to
 * it keeps every view of it in step without any of them re-reading on a
 * schedule.
 */

const STORAGE_KEY = "tome.function-taxonomy.v1";

/** What the server renders, and what the client hydrates against. */
const EMPTY = defaultTaxonomy();

/**
 * The last parse, kept because a snapshot has to be the same object until
 * the stored text actually changes. Parsing afresh on every read would hand
 * React a new object each time and re-render for ever.
 */
let cachedRaw: string | null = null;
let cached: FunctionTaxonomy = EMPTY;

const listeners = new Set<() => void>();

function snapshot(): FunctionTaxonomy {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cached = raw ? normaliseTaxonomy(JSON.parse(raw)) : EMPTY;
    }
  } catch {
    // A copy that cannot be read is a copy this reader loses, not a page
    // that fails to draw.
    cachedRaw = null;
    cached = EMPTY;
  }
  return cached;
}

function serverSnapshot(): FunctionTaxonomy {
  return EMPTY;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Two tabs of the same TOME should not disagree about what exists.
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  cachedRaw = null;
  cached = EMPTY;
  emit();
}

/** Whether the device's own copy is the one being shown. */
const subscribeReady = subscribe;
const readyOnClient = () => true;
const readyOnServer = () => false;

export interface UseFunctionTaxonomy {
  taxonomy: FunctionTaxonomy;
  /** False until the device's copy is in hand, so a view can wait rather than flash. */
  ready: boolean;
  /** Derive the next taxonomy from the current one, and keep it. */
  update: (next: (current: FunctionTaxonomy) => FunctionTaxonomy) => void;
}

export function useFunctionTaxonomy(): UseFunctionTaxonomy {
  const taxonomy = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const ready = useSyncExternalStore(
    subscribeReady,
    readyOnClient,
    readyOnServer,
  );

  const update = useCallback(
    (next: (current: FunctionTaxonomy) => FunctionTaxonomy) => {
      const updated = next(snapshot());
      const serialised = JSON.stringify(updated);
      try {
        window.localStorage.setItem(STORAGE_KEY, serialised);
      } catch {
        // Out of quota, or a browser refusing to store: the change still
        // holds for this page, it simply will not outlive it.
      }
      cachedRaw = serialised;
      cached = updated;
      emit();
    },
    [],
  );

  return { taxonomy, ready, update };
}
