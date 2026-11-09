"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  defaultTaxonomy,
  normaliseTaxonomy,
  reconcileConfiguredCategories,
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

/** Which configuration this device has already been given. */
const SEEDED_KEY = "tome.function-taxonomy.seeded.v1";

/**
 * The categories this deployment ships with, as `Function: One, Two | …`.
 *
 * Read from the environment rather than written into the code: what a
 * function calls its own divisions belongs to whoever runs TOME, not to the
 * product, and naming one organisation's divisions here would make every
 * other organisation delete them before making their own.
 *
 * Referenced in full so the build can inline it into the browser bundle.
 */
const CONFIGURED = process.env.NEXT_PUBLIC_TOME_FUNCTION_CATEGORIES;

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

/**
 * Give this device the configured categories, once per configuration.
 *
 * Marked rather than repeated, so a category deleted here stays deleted,
 * while a line added to the configuration still reaches a device that has
 * been using TOME for months. Run at import, before the first snapshot, so
 * the view never draws the organisation without them and then again with.
 *
 * Takes the configuration as an argument so a test can hand it one without
 * reloading the module, which would give the test a second copy of React.
 */
export function applyConfiguredCategories(configured = CONFIGURED): void {
  try {
    const marker = configured ?? "";
    const previous = window.localStorage.getItem(SEEDED_KEY);
    if (previous === marker) return;
    window.localStorage.setItem(SEEDED_KEY, marker);

    const raw = window.localStorage.getItem(STORAGE_KEY);
    const current = raw ? normaliseTaxonomy(JSON.parse(raw)) : defaultTaxonomy();
    const seeded = reconcileConfiguredCategories(current, previous, configured);
    if (seeded === current) return;

    const serialised = JSON.stringify(seeded);
    window.localStorage.setItem(STORAGE_KEY, serialised);
    cachedRaw = serialised;
    cached = seeded;
  } catch {
    // A device that will not be written to still reads its own copy; it
    // simply does not get the configured categories.
  }
}

if (typeof window !== "undefined") applyConfiguredCategories();

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
