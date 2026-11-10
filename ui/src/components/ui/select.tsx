import { cn } from "@/lib/utils";
import * as React from "react";

export type SelectProps = React.ComponentProps<"select">;

/**
 * Native-backed single select for small, static option sets.
 *
 * Browser semantics are intentional: mobile pickers, form participation, and
 * type-ahead keyboard behavior are more useful than search for short lists.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
        "select-chevron",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
        // After `className`, not before it: the room the arrow sits in is not
        // the caller's to give away. Most callers still restate the base
        // padding they predate, and `px-3` merges away a `pr-9` that comes
        // earlier, which would run the longest option straight under the arrow.
        "pr-9",
      )}
      {...props}
    />
  ),
);

Select.displayName = "Select";

export { Select };
