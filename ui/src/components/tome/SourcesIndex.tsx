"use client";

import { ChevronRight, Plug } from "lucide-react";

import { ProviderLogo } from "@/components/credentials/provider-logo";
import { PanelShell } from "@/components/tome/PanelHeader";
import type { SourceWithPages } from "@/lib/tome/sources";

/**
 * Everything this space reads from, one row per system.
 *
 * The landing page behind the rail's Sources row, which like every other
 * first-level row has to go somewhere rather than only open. Each system
 * says how much of this space came from it, so a reader can see at a glance
 * where the material is actually coming from — and which systems are
 * connected to nothing.
 */
export function SourcesIndex({
  sources,
  onOpenSource,
}: {
  sources: SourceWithPages[];
  onOpenSource: (id: string) => void;
}) {
  const connected = sources.filter(
    (entry) => !entry.source.unavailable && entry.count > 0,
  ).length;

  return (
    <PanelShell
      title="Sources"
      description="The systems this space reads from. Their material is mirrored page by page, and what is live — issues, tickets — stays where it is raised."
      titleAccessory={
        <span className="text-xs font-normal text-muted-foreground">
          {connected} connected
        </span>
      }
    >
      <div className="divide-y">
        {sources.map(({ source, count }) => (
          <button
            key={source.id}
            type="button"
            onClick={() => onOpenSource(source.id)}
            className="flex w-full items-center gap-3 px-2 py-4 text-left transition-colors hover:bg-muted/60"
          >
            <ProviderLogo
              provider={source.provider}
              className="h-5 w-5 shrink-0 object-contain"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{source.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {source.blurb}
              </span>
            </span>

            {source.unavailable ? (
              // Said plainly rather than shown as nought: nothing arrived
              // from here because nothing could, and a reader comparing it
              // with a connected-but-empty source needs to tell them apart.
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Plug className="h-3.5 w-3.5" aria-hidden />
                Not connected
              </span>
            ) : (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {count} {count === 1 ? "page" : "pages"}
              </span>
            )}

            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </PanelShell>
  );
}
