import { create } from "zustand";

export type AskTomeTab = "chat" | "history";

/** The real panel's own figures, so the stand-in takes up the same room. */
export const ASK_TOME_DEFAULT_SIZE = { width: 720, height: 780 };
export const ASK_TOME_MIN_SIZE = { width: 480, height: 560 };
export const ASK_TOME_MAX_SIZE = { width: 1180, height: 940 };

interface AskTomeState {
  open: boolean;
  tab: AskTomeTab;
  expanded: boolean;
  size: { width: number; height: number };
  setOpen: (open: boolean) => void;
  setTab: (tab: AskTomeTab) => void;
  setExpanded: (expanded: boolean) => void;
  setSize: (size: { width: number; height: number }) => void;
}

/**
 * Where the Ask Tome panel keeps what it is doing.
 *
 * Outside the component, because the panel is mounted per surface — the hub
 * has one, a project's wiki has one — and moving between them takes the
 * component down and puts another up. Held in the component, that would shut
 * the panel every time a reader followed a link, which is the opposite of a
 * thing that follows you around.
 *
 * Not written to storage: a reader who loads the page afresh has not asked
 * for anything yet, and a chat that opens itself on arrival is a chat that
 * has to be closed on arrival.
 */
export const useAskTomeStore = create<AskTomeState>((set) => ({
  open: false,
  tab: "chat",
  expanded: false,
  size: ASK_TOME_DEFAULT_SIZE,
  setOpen: (open) => set({ open }),
  setTab: (tab) => set({ tab }),
  setExpanded: (expanded) => set({ expanded }),
  setSize: (size) => set({ size }),
}));
