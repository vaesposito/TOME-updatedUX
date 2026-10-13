import { create } from "zustand";

import { apiClient } from "@/lib/api-client";
import {
  DEFAULT_TOME_HOME_LAYOUT,
  parseLayout,
  withHidden,
  withOrder,
  withShown,
  type TomeHomeLayout,
  type TomeHomeWidgetId,
} from "@/lib/tome/home-widgets";

/**
 * How a reader has arranged the cards on a project's home page.
 *
 * Written to this browser first and to the account behind it after, as the
 * main home page's widgets are: dragging a card should land before the
 * network is involved, and the arrangement should still be there on another
 * machine. A failed sync is logged and otherwise ignored — losing an
 * arrangement is a disappointment, not an error worth a dialog.
 */

const STORAGE_KEY = "caipe-tome-home-widgets";

function readStoredLayout(): TomeHomeLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseLayout(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function store(layout: TomeHomeLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // A browser refusing to store it is not a reason to refuse to apply it.
  }
}

function persist(layout: TomeHomeLayout): void {
  void apiClient
    .updatePreferences({
      tome_home_widgets: {
        order: [...layout.order],
        hidden: [...layout.hidden],
      },
    })
    .catch((error: unknown) => {
      console.warn("[tome-home-widgets] Could not save the arrangement", error);
    });
}

interface TomeHomeWidgetsState {
  layout: TomeHomeLayout;
  initialized: boolean;
  /** Set by the reader's first change, after which the server has nothing to teach us. */
  touched: boolean;

  initialize: () => void;
  hideWidget: (id: TomeHomeWidgetId) => void;
  showWidget: (id: TomeHomeWidgetId) => void;
  reorderWidgets: (shown: readonly TomeHomeWidgetId[]) => void;
  resetLayout: () => void;
}

export const useTomeHomeWidgetsStore = create<TomeHomeWidgetsState>((set, get) => {
  const apply = (layout: TomeHomeLayout) => {
    store(layout);
    set({ layout, touched: true });
    persist(layout);
  };

  return {
    layout: DEFAULT_TOME_HOME_LAYOUT,
    initialized: false,
    touched: false,

    initialize: () => {
      if (get().initialized) return;
      const stored = readStoredLayout();
      set({ layout: stored ?? DEFAULT_TOME_HOME_LAYOUT, initialized: true });

      apiClient
        .getSettings()
        .then((settings) => {
          // A card dragged while this was in flight is the newer answer.
          if (get().touched) return;
          const saved = settings?.preferences?.tome_home_widgets;

          // This browser's own copy wins. It is written the moment a card
          // moves, so if it exists it is what this reader last chose here,
          // whereas the account's copy is only as current as the last save
          // that actually completed — and a save that did not complete must
          // not be allowed to undo the arrangement on screen. Push it back
          // up instead, so a dropped save repairs itself on the next visit.
          if (stored) {
            if (JSON.stringify(parseLayout(saved)) !== JSON.stringify(stored)) {
              persist(stored);
            }
            return;
          }

          // Nothing arranged in this browser, so the account is where an
          // arrangement made on another machine comes from.
          if (!saved) return;
          const layout = parseLayout(saved);
          store(layout);
          set({ layout });
        })
        .catch((error: unknown) => {
          console.warn(
            "[tome-home-widgets] Account preferences could not be loaded",
            error,
          );
        });
    },

    hideWidget: (id) => apply(withHidden(get().layout, id)),
    showWidget: (id) => apply(withShown(get().layout, id)),
    reorderWidgets: (shown) => apply(withOrder(get().layout, shown)),
    resetLayout: () => apply(DEFAULT_TOME_HOME_LAYOUT),
  };
});
