/**
 * The theme the prototype opens in.
 *
 * Named once and read in two places that must agree: the inline script in
 * the document head, which decides the first paint, and `ThemeProvider`,
 * which decides what happens if that script never ran. Disagreeing would
 * show as a flicker on the way in.
 *
 * Dark rather than the system preference, because this is a page someone is
 * shown rather than an application they have configured, and the system
 * preference of whichever machine it is opened on is not a choice anyone
 * made about TOME.
 *
 * A starting point, not a lock: Settings → Appearance switches it, and the
 * choice is stored under the same `theme` key the application uses, so it
 * holds for the rest of the visit.
 */
export const PROTOTYPE_THEME = "dark";
