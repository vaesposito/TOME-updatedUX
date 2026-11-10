/**
 * The shape of every button in the catalogue's welcome band.
 *
 * Settings, Connect via MCP and the tour are three different kinds of
 * element — a link, a dialog trigger, a popover trigger — in three different
 * files, and each had been given its own height, padding and type size. They
 * drifted, as three copies of a measurement do, and the row read as
 * misaligned rather than as a set.
 *
 * Height is stated rather than grown from the padding, because a `Button`
 * states its own and a bare link cannot match one it has to guess.
 */
export const HUB_CTA_CLASS =
  "h-8 gap-1.5 rounded-lg px-3 text-xs font-medium";
