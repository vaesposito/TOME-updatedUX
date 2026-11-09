"use client";

import { Info, X } from "lucide-react";
import * as React from "react";

import { useVersion } from "@/hooks/use-version";
import { cn } from "@/lib/utils";

/** The note's width, needed to keep it inside the window. */
const NOTE_WIDTH = 320;

/**
 * What this TOME is, for anyone who has to say which one they were looking at.
 *
 * A note rather than a tooltip proper: a release and a commit are things a
 * reader copies into a bug report, and a panel that vanishes the moment the
 * pointer leaves cannot be copied from. It closes from its own cross, the
 * same way the Webex note in Ask Tome does.
 */
export function TomeVersionNote({ className }: { className?: string }) {
  const { versionInfo, isLoading } = useVersion();
  const [open, setOpen] = React.useState(false);
  // In viewport coordinates: the banner clips its children, so the note
  // cannot simply hang off the button inside it.
  const [at, setAt] = React.useState<{ x: number; y: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  const show = React.useCallback(() => {
    const box = buttonRef.current?.getBoundingClientRect();
    if (!box) return;
    setAt({
      x: Math.min(box.left, window.innerWidth - NOTE_WIDTH - 16),
      y: box.bottom + 8,
    });
    setOpen(true);
  }, []);

  const built = versionInfo?.buildDate
    ? new Date(versionInfo.buildDate).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-label="Version and build information"
        onClick={() => (open ? setOpen(false) : show())}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground",
          className,
        )}
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>

      {open && at && (
        <section
          aria-label="Version and build information"
          style={{ left: at.x, top: at.y, width: NOTE_WIDTH }}
          className="fixed z-50 rounded-xl border border-border bg-popover shadow-xl"
        >
          <div className="flex items-start gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xs font-semibold text-foreground">
                Version and build information
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                Which TOME this is.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close the version information"
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-full p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <dl className="space-y-2.5 px-3 py-3 text-xs">
            {isLoading ? (
              <p className="text-muted-foreground">Reading the build…</p>
            ) : (
              <>
                <Row label="TOME release" value={versionInfo?.version} />
                {/* Whole, not shortened: the reason to read a commit here is
                    to paste it somewhere that wants all of it. */}
                <Row label="TOME commit" value={versionInfo?.gitCommit} mono />
                <Row label="Built" value={built} />
              </>
            )}
          </dl>
        </section>
      )}
    </>
  );
}

/** One fact, left unsaid where the build does not report it. */
function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | undefined;
  mono?: boolean;
}) {
  if (!value || value === "unknown") return null;
  return (
    <div>
      <dt className="font-medium text-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 break-all text-muted-foreground",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
