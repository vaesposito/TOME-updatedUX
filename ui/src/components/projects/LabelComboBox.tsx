"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Datalist-backed free-text combobox for project label dimensions
 * (BHAG / Initiative, Swim Lane). Shared by the onboarding wizard and the
 * project Settings pane so both surfaces have identical UX: type a new value or
 * pick an existing one; `multi` keeps a comma-separated list in the input.
 *
 * Value is the raw input string (comma/newline-separated when `multi`). Callers
 * split it into a string[] at submit time.
 */
export function applyComboSelection(
  current: string,
  selected: string,
  multi: boolean,
): string {
  if (!multi) return selected;
  const lastDelim = Math.max(current.lastIndexOf(","), current.lastIndexOf("\n"));
  const head = lastDelim >= 0 ? current.slice(0, lastDelim + 1) : "";
  return `${head ? head.trimEnd() + " " : ""}${selected}, `;
}

export function LabelComboBox({
  value,
  onChange,
  options,
  placeholder,
  multi = false,
  onType,
  ariaLabel,
  id,
  container,
  inputClassName = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  multi?: boolean;
  onType?: (v: string) => void;
  ariaLabel?: string;
  id?: string;
  /**
   * Where the list is portalled. Inside a modal dialog it has to land within
   * the dialog's own node: a list hanging off `body` sits outside the layer
   * that watches for clicks elsewhere, so choosing from it would be read as
   * clicking away and would shut the dialog. Defaults to `body`, which is
   * right everywhere else.
   */
  container?: HTMLElement | null;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  // Whether the list is narrowed yet. Opening a field that already holds a
  // value would otherwise show only that value back, which hides every other
  // choice behind deleting the one already there.
  const [narrowing, setNarrowing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  /**
   * Put the list under its field as it mounts.
   *
   * Measured onto the node rather than into state: the anchor cannot be known
   * before there is a node to measure against, and a render spent carrying
   * the numbers back buys nothing when nothing else reads them.
   *
   * Viewport coordinates only hold while the list hangs off `body`. A
   * container that is itself positioned — a dialog, which is fixed and
   * centred by a transform — becomes what `fixed` resolves against, so inside
   * one the offsets are measured from the container instead.
   */
  const place = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const base = container?.getBoundingClientRect();
      if (base) {
        node.style.position = "absolute";
        node.style.top = `${rect.bottom - base.top - container.clientTop + 4}px`;
        node.style.left = `${rect.left - base.left - container.clientLeft}px`;
      } else {
        node.style.position = "fixed";
        node.style.top = `${rect.bottom + 4}px`;
        node.style.left = `${rect.left}px`;
      }
      node.style.width = `${rect.width}px`;
      node.style.zIndex = "9999";
    },
    [container],
  );

  // The list is placed once and does not follow its field, so scrolling with
  // it open would leave it behind. Closing is both cheaper and less startling
  // than watching it drift.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  const typed = (multi ? (value.split(/[\n,]/).pop() ?? "") : value).trim().toLowerCase();
  const lastToken = narrowing ? typed : "";
  const filtered = options
    .filter(
      (o) =>
        !lastToken ||
        o.label.toLowerCase().includes(lastToken) ||
        o.value.toLowerCase().includes(lastToken),
    )
    .slice(0, 50);

  // Reset highlight when the list changes. Adjusted directly during render
  // (React's recommended pattern for "state derived from a changing prop":
  // https://react.dev/learn/you-might-not-need-an-effect) rather than in an
  // effect, which would fire an extra render after paint. Uses plain state
  // (not a ref) to track the previous key — refs can't be written during
  // render. `itemRefs` doesn't need clearing here: each visible item's
  // callback ref reattaches on every render, so stale entries beyond the
  // new (shorter) list are simply never read again.
  const resetKey = `${open}:${filtered.length}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setActiveIndex(-1);
  }

  const selectItem = (o: { value: string; label: string }) => {
    onChange(applyComboSelection(value, o.value, multi));
    onType?.("");
    setNarrowing(false);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(activeIndex + 1, filtered.length - 1);
      setActiveIndex(next);
      itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(activeIndex - 1, 0);
      setActiveIndex(prev);
      itemRefs.current[prev]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectItem(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const dropdown =
    open && filtered.length > 0
      ? createPortal(
          <div
            id={listboxId}
            ref={place}
            role="listbox"
            className="pointer-events-auto max-h-56 overflow-auto rounded-xl border border-border/60 bg-card shadow-xl"
          >
            {filtered.map((o, i) => (
              <button
                type="button"
                key={o.value}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                ref={(el) => { itemRefs.current[i] = el; }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectItem(o);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`block w-full px-3 py-2 text-left transition ${i === activeIndex ? "bg-accent/80" : "hover:bg-accent/60"}`}
              >
                <span className="block truncate text-sm">{o.label}</span>
                {o.label !== o.value ? (
                  <span className="block truncate text-xs text-muted-foreground">{o.value}</span>
                ) : null}
              </button>
            ))}
          </div>,
          container ?? document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        aria-label={ariaLabel}
        aria-expanded={open && filtered.length > 0}
        aria-controls={open && filtered.length > 0 ? listboxId : undefined}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        role="combobox"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          onType?.(e.target.value);
          setNarrowing(true);
          setOpen(true);
        }}
        onFocus={() => {
          setNarrowing(false);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={inputClassName}
      />
      {dropdown}
    </div>
  );
}
