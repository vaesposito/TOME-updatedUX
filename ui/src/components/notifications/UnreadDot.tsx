import { cn } from "@/lib/utils";

/**
 * The mark for something the reader has not opened yet.
 *
 * One shape in one colour everywhere it appears — beside a notification and
 * beside the page that notification is about — so that noticing it in the
 * wiki tree and noticing it in the inbox are the same act of recognition.
 *
 * A dot rather than an edge down the side of the row: an edge that long
 * reads as a state of the whole card, which is how the bar that used to be
 * here came across as disabled rather than as unread.
 *
 * Read items keep the dot's space instead of closing it up, so titles stay
 * on one left margin down a list and the eye can run along it.
 */
export function UnreadDot({
  unread,
  className,
  label = "Unread",
}: {
  unread: boolean;
  className?: string;
  /** Overridden where "unread" is not the word for it, e.g. "New activity". */
  label?: string;
}) {
  if (!unread) {
    return <span className={cn("h-1.5 w-1.5 shrink-0", className)} aria-hidden="true" />;
  }
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-primary", className)}
    />
  );
}
