/**
 * The browser this prototype pretends the visitor arrived in.
 *
 * TOME keeps a few choices per person rather than per deployment: which
 * feature flags they are on, and whether they have already been through the
 * first-run walkthrough. A visitor here arrives with an empty browser, so
 * without seeding they would be shown the flags' defaults — including the
 * navigation this redesign replaced — and a dialog over the first screen
 * they open.
 *
 * Seeded before the stores first read it rather than switched on afterwards:
 * a flag flipped after hydration would show the old rail for a frame and
 * then swap it.
 */

/** The key the feature flag store keeps its copy under. */
const FLAGS_KEY = "caipe-feature-flags";

/** The key TOME marks the first-run walkthrough seen under. */
const ONBOARDING_SEEN_KEY = "tome.onboarding.seen";

/** What this prototype is showing, by flag id. */
export const PROTOTYPE_FLAGS: Record<string, boolean> = {
  tomeNavV2: true,
};

/**
 * The same choices in the shape account preferences carry them.
 *
 * The flag store asks the server for the account's flags once it has read
 * this browser's, and takes the server's answer for anything the reader has
 * not touched themselves. Answering with the flags above keeps the two from
 * disagreeing a moment after the page settles.
 */
export const PROTOTYPE_PREFERENCES: Record<string, string> = {
  tome_nav_v2_enabled: "true",
};

/**
 * Finds the marks the export leaves pointing at the domain root.
 *
 * This site is published under a prefix. Next rewrites the paths it knows
 * about, but a handful of marks in the application — the provider logos and
 * the walkthrough's wordmark — are drawn with a plain `<img src="/...">`,
 * which it leaves alone, so the browser looks for them one directory too
 * high. Caught on the failure rather than rewritten up front because there
 * is no one place those marks pass through.
 */
export function repointRootAbsoluteAssets(): void {
  if (typeof window === "undefined") return;
  const prefix = process.env.NEXT_PUBLIC_PROTOTYPE_BASE_PATH ?? "";
  if (!prefix) return;
  window.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      const src = img.getAttribute("src");
      if (!src?.startsWith("/") || src.startsWith(prefix)) return;
      img.setAttribute("src", `${prefix}${src}`);
    },
    // Image failures do not bubble, so the capture phase is the only way to
    // hear about one from here.
    true,
  );
}

export function seedBrowserState(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(FLAGS_KEY);
    const current = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    // The visitor's own switches win: someone who turns the new navigation
    // off to compare it with the old one should stay where they put it.
    window.localStorage.setItem(
      FLAGS_KEY,
      JSON.stringify({ ...PROTOTYPE_FLAGS, ...current }),
    );
    // The walkthrough explains a TOME the reader is here to look at, and it
    // opens over the first space they reach. The help button still offers it.
    if (!window.localStorage.getItem(ONBOARDING_SEEN_KEY)) {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    }
  } catch {
    // A browser refusing storage still gets the preferences answer, which
    // arrives a moment later rather than before the first paint.
  }
}
