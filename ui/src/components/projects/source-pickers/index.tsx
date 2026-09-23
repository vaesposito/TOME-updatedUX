"use client";

import { SourceItemPicker } from "./SourceItemPicker";
import { SOURCE_ADAPTERS } from "./adapters";
import type { ConfluencePageScope, WebexCredentialMode } from "@/types/projects";

/** The connectors a project can draw sources from (YAML `source:` values). */
export type SourceKind = "github" | "confluence" | "webex";

export interface SourcePickerProps {
  /** Render controls inside a parent source card without a second branded card. */
  embedded?: boolean;
  /** Selected values (github: repo URLs/refs; confluence: one space/page URL; webex: room IDs). */
  selected: string[];
  excludedKeys?: string[];
  onChange: (next: string[]) => void;
  confluencePageScopes?: ConfluencePageScope[];
  onConfluencePageScopesChange?: (
    scopes: ConfluencePageScope[],
    sourceUrl?: string,
  ) => void;
  webexCredentialMode?: WebexCredentialMode;
  webexCredentialProvider?: string;
  onRefresh?: () => void;
}

/**
 * Renders the right per-connector picker for a `source` onboarding step. All
 * connectors share one `SourceItemPicker`; each is configured by a declarative
 * adapter (see `adapters.tsx`) — selection cardinality, value encoding, label,
 * manual-add, copy. Selected items are pinned to the top of every list.
 */
export function SourcePicker({
  source,
  embedded,
  selected,
  excludedKeys,
  onChange,
  confluencePageScopes,
  onConfluencePageScopesChange,
  webexCredentialMode,
  webexCredentialProvider,
  onRefresh,
}: { source?: string } & SourcePickerProps) {
  const adapter = source ? SOURCE_ADAPTERS[source as SourceKind] : undefined;
  if (!adapter) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        {`No picker for source "${source ?? "?"}".`}
      </div>
    );
  }
  return (
    <SourceItemPicker
      adapter={adapter}
      embedded={embedded}
      selected={selected}
      excludedKeys={excludedKeys}
      onChange={onChange}
      confluencePageScopes={confluencePageScopes}
      onConfluencePageScopesChange={onConfluencePageScopesChange}
      webexCredentialMode={webexCredentialMode}
      webexCredentialProvider={webexCredentialProvider}
      onRefresh={onRefresh}
    />
  );
}
