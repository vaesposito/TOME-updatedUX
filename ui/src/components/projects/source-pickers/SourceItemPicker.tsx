"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Plus, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { cn } from "@/lib/utils";
import type { ConfluencePageScope, WebexCredentialMode } from "@/types/projects";
import {
  decodeConfluenceSource,
  encodeConfluenceSource,
  parseConfluenceUrl,
} from "@/lib/projects/confluence-source";
import { ConfluenceManualAdd } from "./ConfluenceManualAdd";
import { ConfluenceSpaceBrowser } from "./ConfluenceSpaceBrowser";
import { useSourceOptions, type SourceOption } from "./useSourceOptions";

/**
 * Per-source behavior the generic picker can't infer. The three connectors
 * (GitHub repos, Confluence space, Webex rooms) share all the chrome — a
 * bounded card with a branded header (icon chip, title, status), a merged
 * search+list control, optional manual-add, footer — and differ only on the
 * axes below. Adding a new source connector is now an adapter, not a new
 * component.
 */
export interface SourceAdapter {
  /** Credentials provider id behind `useSourceOptions` (also the `ProviderLogo` key). */
  provider: "github" | "atlassian" | "webex";
  /** Card header title, e.g. "GitHub repos". */
  title: string;
  /** One-line context shown under the title, e.g. what these sources are used for. */
  subtitle: string;
  /** Header icon chip background — a brand-tinted wash or (GitHub) an inverted neutral. */
  chipClass: string;
  multi: boolean;
  /** Unset = unlimited (github/webex today). */
  maxSelected?: number;
  /** Singular / plural noun for counts and copy ("repo"/"repos"). */
  nounOne: string;
  nounMany: string;
  /** Status header preposition: "Connected as X" (github/webex) vs "to X" (confluence). */
  connectedPreposition: "as" | "to";
  /** Show "N matches" while searching (confluence/webex) vs always "N nounMany" (github). */
  showMatchCount: boolean;
  searchPlaceholder: string;
  /** Empty-list copy. `noMatch` falls back to `none` when omitted. */
  emptyNone: string;
  emptyNoMatch?: string;
  /** Not-connected copy: rich (with a Connections link) and the bare fallback. */
  notConnectedHowTo: (connectionsLink: ReactNode, connectionName?: string) => ReactNode;
  notConnectedBare: string;
  /**
   * Shown under the loading skeleton once a first load runs past ~2.5s, so a
   * slow provider (Confluence) reads as "expected" rather than "stuck".
   */
  slowLoadHint?: string;

  /** Stored selected value → stable key used to match options and dedupe. */
  selectedKeyOf: (value: string) => string;
  /** Option → its matching key (defaults to `option.value`). */
  optionKeyOf?: (option: SourceOption) => string;
  /** Render label for a pinned selected value that may not be in `options`. */
  labelOf: (value: string) => string;
  /** Option → the value stored on selection (identity, or webex blob encode). */
  encodeOnAdd: (option: SourceOption) => string;

  /** Optional manual-add row — rendered as its own prominent section, not an afterthought. */
  manualAdd?: {
    placeholder: string;
    button: string;
    withIcon?: boolean;
    /** Short label above the input, e.g. "Know the URL? Paste it directly". */
    hint: string;
    /** Normalize raw input → stored value (null/empty rejects). Defaults to trim. */
    parse?: (input: string) => string | null;
    /** Reject input that looks meant for a different connector, with a message explaining why. */
    rejectReason?: (input: string) => string | null;
  };
  /** Footer line; return null to omit. */
  footer?: (selected: string[]) => ReactNode;
}

interface Row {
  key: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export function SourceItemPicker({
  adapter,
  embedded = false,
  selected,
  excludedKeys = [],
  onChange,
  webexCredentialMode,
  webexCredentialProvider,
  onRefresh,
}: {
  adapter: SourceAdapter;
  embedded?: boolean;
  selected: string[];
  excludedKeys?: string[];
  onChange: (next: string[]) => void;
  webexCredentialMode?: WebexCredentialMode;
  webexCredentialProvider?: string;
  onRefresh?: () => void;
}) {
  const {
    connected,
    connection,
    connectedTo,
    options,
    loading,
    error,
    manageUrl,
    managedCapability,
    search,
    reload,
  } =
    useSourceOptions(adapter.provider, {
      webexMode: webexCredentialMode,
      webexCredentialProvider,
    });
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [managedEmailCopied, setManagedEmailCopied] = useState(false);
  // Confluence: search+list collapses behind "+ Add" once a space exists.
  const [addingSpace, setAddingSpace] = useState(false);
  // Confluence: only one space's scope panel expanded at a time, by key.
  const [expandedSpaceKey, setExpandedSpaceKey] = useState<string | null>(null);
  // Confluence: a space picked from the list but not committed until its
  // scope choice is confirmed, same as the manual-URL preview-then-add flow.
  const [stagingValue, setStagingValue] = useState<string | null>(null);
  const [stagingError, setStagingError] = useState("");

  // A first load with no rows yet that runs past ~2.5s surfaces the adapter's
  // slow-load copy (Confluence in particular), so it reads as expected rather
  // than stuck.
  const [showSlowHint, setShowSlowHint] = useState(false);
  useEffect(() => {
    if (!loading || options.length > 0 || !adapter.slowLoadHint) {
      setShowSlowHint(false);
      return;
    }
    const t = setTimeout(() => setShowSlowHint(true), 2500);
    return () => clearTimeout(t);
  }, [loading, options.length, adapter.slowLoadHint]);

  const optionKeyOf = adapter.optionKeyOf ?? ((o: SourceOption) => o.value);

  // Selected keys (ordered as stored) for matching + pinning.
  const selectedKeys = useMemo(
    () => selected.map(adapter.selectedKeyOf),
    [selected, adapter],
  );
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const atCap = adapter.maxSelected != null && selected.length >= adapter.maxSelected;

  const removeByKey = (key: string) => {
    onChange(selected.filter((s) => adapter.selectedKeyOf(s) !== key));
  };

  const addValue = (value: string) => {
    if (adapter.multi && atCap) return;
    onChange(adapter.multi ? [...selected, value] : [value]);
    if (adapter.provider === "atlassian") {
      setAddingSpace(false);
      // Open straight to the new space's scope panel; collapse the rest.
      setExpandedSpaceKey(adapter.selectedKeyOf(value));
    }
  };

  const commitConfluenceSpace = (
    url: string,
    scopes: ConfluencePageScope[],
  ): "ok" | "duplicate" | "cap" => {
    const parsed = parseConfluenceUrl(url);
    const spaceKey = parsed?.space_key ?? scopes[0]?.space_key ?? "";
    const encoded = encodeConfluenceSource({
      url,
      base_url: parsed?.base_url ?? "",
      space_key: spaceKey,
      name: spaceKey || url,
      page_scopes: scopes,
    });
    if (selectedKeySet.has(adapter.selectedKeyOf(encoded))) return "duplicate";
    if (atCap) return "cap";
    onChange([...selected, encoded]);
    setAddingSpace(false);
    // Auto-expand only an entire-space add, where narrowing to a page tree
    // is a likely next step — a page scope is already fully resolved.
    setExpandedSpaceKey(scopes.length ? null : adapter.selectedKeyOf(encoded));
    return "ok";
  };

  const addConfluenceValue = (
    url: string,
    scope?: ConfluencePageScope,
  ): "ok" | "duplicate" | "cap" =>
    commitConfluenceSpace(url, scope ? [scope] : []);

  const stageConfluenceValue = (value: string) => {
    setAddingSpace(false);
    setExpandedSpaceKey(null);
    setStagingError("");
    setStagingValue(value);
  };

  const addStagedSpace = (url: string, scopes: ConfluencePageScope[]) => {
    const result = commitConfluenceSpace(url, scopes);
    if (result !== "ok") {
      setStagingError(
        result === "duplicate"
          ? "This space is already added."
          : "This project already has the maximum number of Confluence spaces.",
      );
      return;
    }
    setStagingValue(null);
  };

  const updateConfluenceScopes = (
    index: number,
    url: string,
    scopes: ConfluencePageScope[],
  ) => {
    const decoded = decodeConfluenceSource(selected[index]);
    const next = [...selected];
    next[index] = encodeConfluenceSource({
      url,
      base_url: decoded.base_url,
      space_key: decoded.space_key,
      name: decoded.name,
      page_scopes: scopes,
      slug: decoded.slug,
    });
    onChange(next);
  };

  // Selected pinned at top (stable, in stored order), then unselected options.
  // Confluence spaces remove themselves via their own card button, not this list.
  const rows: Row[] = useMemo(() => {
    const optionByKey = new Map(options.map((o) => [optionKeyOf(o), o]));
    const pinnedDisabled = adapter.provider === "atlassian";
    const pinned: Row[] = selected.map((value) => {
      const key = adapter.selectedKeyOf(value);
      const opt = optionByKey.get(key);
      return {
        key,
        label: opt ? opt.label : adapter.labelOf(value),
        selected: true,
        disabled: pinnedDisabled,
        onToggle: pinnedDisabled ? () => {} : () => removeByKey(key),
      };
    });
    const rest: Row[] = options
      .filter((o) => !selectedKeySet.has(optionKeyOf(o)) && !excludedKeys.includes(optionKeyOf(o)))
      .map((o) => ({
        key: optionKeyOf(o),
        label: o.label,
        selected: false,
        onToggle: () =>
          adapter.provider === "atlassian"
            ? stageConfluenceValue(adapter.encodeOnAdd(o))
            : addValue(adapter.encodeOnAdd(o)),
      }));
    return [...pinned, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, selected, selectedKeySet, adapter, excludedKeys]);

  const addManual = () => {
    const rejectReason = adapter.manualAdd?.rejectReason?.(manual) ?? null;
    if (rejectReason) {
      setManualError(rejectReason);
      return;
    }
    setManualError(null);
    const parsed = adapter.manualAdd?.parse
      ? adapter.manualAdd.parse(manual)
      : manual.trim() || null;
    if (!parsed) return;
    if (adapter.multi && selectedKeySet.has(adapter.selectedKeyOf(parsed))) {
      setManual("");
      return;
    }
    addValue(parsed);
    setManual("");
  };

  const countText = loading
    ? "loading…"
    : query.trim() && adapter.showMatchCount
      ? `${options.length} match${options.length === 1 ? "" : "es"}`
      : `${options.length} ${adapter.nounMany}`;
  const labelForValue = (value: string) =>
    options.find((option) => optionKeyOf(option) === adapter.selectedKeyOf(value))
      ?.label ?? adapter.labelOf(value);
  const confluenceScopeSummary = (scopes: ConfluencePageScope[]) =>
    scopes.length
      ? `${scopes.length} page root${scopes.length === 1 ? "" : "s"} selected`
      : "Entire space";
  const managedWebex =
    adapter.provider === "webex" && webexCredentialMode === "managed";
  const managedAccountEmail = managedCapability?.accountEmail;
  const hasAlreadyAddedSpaces = options.some((option) => excludedKeys.includes(optionKeyOf(option)));
  const emptyListCopy =
    managedWebex && error
      ? error
      : managedWebex && managedAccountEmail
      ? query.trim()
        ? `No ${hasAlreadyAddedSpaces ? "new " : ""}shared Webex spaces match your search.`
        : `No ${hasAlreadyAddedSpaces ? "new " : ""}shared spaces found. You and ${managedAccountEmail} must both be members.`
      : query.trim()
        ? adapter.emptyNoMatch ?? adapter.emptyNone
        : adapter.emptyNone;

  const copyManagedAccountEmail = async () => {
    if (!managedAccountEmail) return;
    try {
      await navigator.clipboard.writeText(managedAccountEmail);
      setManagedEmailCopied(true);
      setTimeout(() => setManagedEmailCopied(false), 1500);
    } catch {
      setManagedEmailCopied(false);
    }
  };

  // Shared search+list markup, reused by both render paths below.
  const searchListBox = (connected || loading) ? (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            search(v.trim());
          }}
          placeholder={adapter.searchPlaceholder}
          disabled={!connected}
          className="w-full bg-transparent py-2.5 text-sm outline-none disabled:cursor-default"
        />
        {connected && (
          <span className="shrink-0 text-xs text-muted-foreground">{countText}</span>
        )}
      </div>
      <div className="h-40 overflow-y-auto">
        {rows.length === 0 && loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
            <div className="w-full space-y-2" data-testid="skeleton">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted-foreground/20" />
                  <div
                    className="h-3.5 animate-pulse rounded bg-muted-foreground/20"
                    style={{ width: `${60 - i * 8}%` }}
                  />
                </div>
              ))}
            </div>
            {showSlowHint && adapter.slowLoadHint && (
              <p className="max-w-[85%] text-center text-xs text-muted-foreground">
                {adapter.slowLoadHint}
              </p>
            )}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="px-4 text-center">{emptyListCopy}</span>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {rows.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={r.onToggle}
                  disabled={r.disabled}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition",
                    r.disabled ? "cursor-default opacity-60" : "hover:bg-accent/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center border",
                      adapter.multi ? "rounded" : "rounded-full",
                      r.selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {r.selected && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{r.label}</span>
                  {r.disabled && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      Added
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  ) : null;

  const connectionsLink = manageUrl && !managedWebex ? (
    <a
      href={manageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
    >
      Connections
    </a>
  ) : null;

  return (
    <div className={embedded ? "space-y-3" : "overflow-hidden rounded-2xl border border-border bg-card"}>
      {/* Header: brand chip + title/subtitle + connection status + refresh — one
          row, so each connector reads as its own distinct unit at a glance. */}
      <div className={cn("flex items-center gap-2.5", !embedded && "border-b border-border bg-muted/40 px-4 py-3")}>
        {!embedded ? <>
          <span className={cn("flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg", adapter.chipClass)}>
            <ProviderLogo provider={adapter.provider} className="h-[15px] w-[15px] object-contain" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">{adapter.title}</div>
            <div className="truncate text-xs text-muted-foreground">{adapter.subtitle}</div>
          </div>
        </> : null}
        <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", !embedded && "ml-auto")}>
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              connected ? "bg-emerald-500" : loading ? "bg-muted-foreground/40" : "bg-amber-500",
            )}
          />
          {connected ? (
            <>
              Connected
              {connectedTo ? (
                <>
                  {" "}
                  {adapter.connectedPreposition} <span className="font-medium text-foreground">{connectedTo}</span>
                </>
              ) : null}
            </>
          ) : loading ? (
            // First load: connection status is still unknown — don't claim "not
            // connected" until we actually know.
            "Checking…"
          ) : (
            managedWebex ? "Managed account unavailable" : "Not connected"
          )}
        </span>
        <Button variant="ghost" size="sm" className={cn("h-7 w-7 shrink-0 p-0", embedded && "ml-auto")} onClick={() => { reload(); onRefresh?.(); }} title="Refresh">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className={cn("space-y-3", !embedded && "p-4")}>
        {managedWebex && connected && managedAccountEmail ? (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <p>
              Add <span className="font-mono font-medium text-foreground">{managedAccountEmail}</span>{" "}
              to each Webex space you want to ingest, then use Refresh above.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 h-7 px-2 text-xs"
              onClick={() => void copyManagedAccountEmail()}
              aria-label="Copy managed Webex account email"
            >
              {managedEmailCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {managedEmailCopied ? "Copied" : "Copy email"}
            </Button>
          </div>
        ) : null}

        {!connected && !loading && (
          <p className="text-sm text-muted-foreground">
            {managedWebex
              ? managedCapability?.reason ||
                "The managed Webex account needs reconnection."
              : manageUrl
                ? adapter.notConnectedHowTo(connectionsLink, connection?.name)
                : adapter.notConnectedBare}
          </p>
        )}

        {adapter.provider !== "atlassian" && searchListBox}

        {adapter.provider === "atlassian" ? (
          <>
            {/* One card per attached space; only the one being edited expands. */}
            {selected.map((value, index) => {
              const decoded = decodeConfluenceSource(value);
              const label = labelForValue(value);
              const key = adapter.selectedKeyOf(value) || String(index);
              const isExpanded = expandedSpaceKey === key;
              return (
                <div
                  key={key}
                  className="overflow-hidden rounded-lg border border-border border-l-4 border-l-[#2684FF]/70"
                >
                  <div className="flex items-center justify-between gap-2 bg-muted/30 px-3 py-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setExpandedSpaceKey(isExpanded ? null : key)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 truncate">
                        Connected to{" "}
                        <span className="font-medium text-foreground">{label}</span>
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onChange(selected.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  </div>
                  {isExpanded ? (
                    <div className="border-t border-border p-3">
                      <ConfluenceSpaceBrowser
                        sourceUrl={decoded.url}
                        scopes={decoded.page_scopes}
                        spaceLabel={label}
                        groupName={key}
                        embedded
                        onSelect={(url, scopes) => updateConfluenceScopes(index, url, scopes)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setExpandedSpaceKey(key)}
                      className="block w-full border-t border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent/30"
                    >
                      {confluenceScopeSummary(decoded.page_scopes)} · Edit
                    </button>
                  )}
                </div>
              );
            })}

            {stagingValue ? (
              <div className="overflow-hidden rounded-lg border border-border border-l-4 border-l-[#2684FF]/70">
                <div className="flex items-center justify-between gap-2 bg-muted/30 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    Add{" "}
                    <span className="font-medium text-foreground">
                      {labelForValue(stagingValue)}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => {
                      setStagingValue(null);
                      setStagingError("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                {stagingError ? (
                  <p role="alert" className="border-t border-border px-3 py-2 text-xs text-destructive">
                    {stagingError}
                  </p>
                ) : null}
                <div className="border-t border-border p-3">
                  <ConfluenceSpaceBrowser
                    sourceUrl={decodeConfluenceSource(stagingValue).url}
                    scopes={[]}
                    spaceLabel={labelForValue(stagingValue)}
                    groupName="staging"
                    embedded
                    requireExplicitAdd
                    onSelect={addStagedSpace}
                  />
                </div>
              </div>
            ) : null}

            {selected.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {selected.length}
                {adapter.maxSelected != null ? ` of ${adapter.maxSelected}` : ""}{" "}
                space{selected.length === 1 ? "" : "s"} selected
              </p>
            ) : null}

            {atCap ? (
              <p className="text-xs text-muted-foreground">
                Up to {adapter.maxSelected} Confluence spaces per project.
              </p>
            ) : selected.length > 0 && !addingSpace ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setAddingSpace(true);
                  setExpandedSpaceKey(null);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Confluence space
              </Button>
            ) : (
              <>
                {searchListBox}
                {adapter.manualAdd ? (
                  <ConfluenceManualAdd
                    value={manual}
                    onValueChange={setManual}
                    onSelect={addConfluenceValue}
                  />
                ) : null}
                {selected.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAddingSpace(false)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </>
            )}
          </>
        ) : adapter.manualAdd ? (
          <div className="rounded-lg border border-dashed border-border/60 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{adapter.manualAdd.hint}</p>
            <div className="flex items-center gap-2">
              <input
                value={manual}
                onChange={(e) => {
                  setManual(e.target.value);
                  setManualError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManual();
                  }
                }}
                placeholder={adapter.manualAdd.placeholder}
                className={cn(
                  "flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2",
                  manualError
                    ? "border-red-500 focus:border-red-500 focus:ring-red-500/30"
                    : "border-border/60 focus:border-primary focus:ring-primary/30",
                )}
              />
              <Button size="sm" onClick={addManual} disabled={!manual.trim()}>
                {adapter.manualAdd.withIcon && <Plus className="h-3.5 w-3.5" />}
                {adapter.manualAdd.button}
              </Button>
            </div>
            {manualError && <p className="mt-2 text-xs text-red-500">{manualError}</p>}
          </div>
        ) : null}

        {adapter.provider !== "atlassian" && adapter.footer?.(selected)}
      </div>
    </div>
  );
}
