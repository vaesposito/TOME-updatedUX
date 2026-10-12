"use client";

import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The checkbox mark, drawn rather than delegated to a native input. The
 * browser control ignores the theme and paints the operating system's square,
 * which is the one piece of chrome in the inbox that looks imported from
 * somewhere else.
 *
 * It renders a span so it can also sit inside the sidebar's filter buttons,
 * where a nested interactive element would be invalid markup; there the
 * surrounding button owns the click and the checkbox role.
 *
 * Both states are held above WCAG 1.4.11's 3:1 floor for a control's visible
 * boundary in all nine themes. That rules out `--input` for the empty box,
 * which sits at 1.1–1.2:1 against the surfaces the inbox uses and is close to
 * invisible. The mark rides on --primary-foreground, which is chosen
 * against the accent rather than fixed per theme.
 */
export function CheckboxMark({
  checked,
  indeterminate,
  className,
}: {
  checked: boolean;
  /** Some but not all of the set — drawn as a dash, as everywhere else. */
  indeterminate?: boolean;
  className?: string;
}) {
  const filled = checked || indeterminate;

  return (
    <span
      className={cn(
        // The outline is the same in both states and the interior is what
        // changes. Tying it to the fill instead would hand the control's only
        // boundary to the accent, which on a light theme is 2.2:1 against the
        // page; this way the edge clears 3:1 whatever accent is chosen.
        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border border-muted-foreground transition-colors",
        filled ? "bg-primary text-primary-foreground" : "group-hover:border-foreground",
        className,
      )}
    >
      {indeterminate ? (
        <Minus className="h-2.5 w-2.5" aria-hidden="true" />
      ) : checked ? (
        <Check className="h-2.5 w-2.5" aria-hidden="true" />
      ) : null}
    </span>
  );
}

/** A standalone checkbox, for inbox rows and for Select all. */
export function SelectionCheckbox({
  checked,
  indeterminate,
  onCheckedChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      // A partly-filled box clears the selection rather than completing it,
      // which is what every other inbox does with that click.
      onClick={() => onCheckedChange(indeterminate ? false : !checked)}
      className={cn(
        "group flex shrink-0 items-center justify-center rounded-[3px] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      <CheckboxMark checked={checked} indeterminate={indeterminate} />
    </button>
  );
}
