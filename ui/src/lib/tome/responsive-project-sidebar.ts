import { useCallback, useEffect, useState } from "react";

export const TOME_COMPACT_LAYOUT_QUERY = "(max-width: 767px)";

/**
 * Keeps the project navigation available as a desktop rail and a mobile
 * drawer. Crossing the responsive breakpoint restores the natural default:
 * open on desktop, closed on compact screens.
 */
export function useResponsiveProjectSidebar() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const media = window.matchMedia(TOME_COMPACT_LAYOUT_QUERY);
    const syncWithViewport = () => setOpen(!media.matches);

    syncWithViewport();
    media.addEventListener("change", syncWithViewport);
    return () => media.removeEventListener("change", syncWithViewport);
  }, []);

  const toggle = useCallback(() => setOpen((current) => !current), []);
  const close = useCallback(() => setOpen(false), []);
  const closeOnCompact = useCallback(() => {
    if (window.matchMedia(TOME_COMPACT_LAYOUT_QUERY).matches) setOpen(false);
  }, []);

  return { open, toggle, close, closeOnCompact };
}
