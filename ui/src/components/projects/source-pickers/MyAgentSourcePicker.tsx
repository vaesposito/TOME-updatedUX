"use client";

import { Bot, Check, ExternalLink, ShieldCheck } from "lucide-react";

import {
  MYAGENT_CONNECTOR_OPTIONS,
  MYAGENT_CONNECTOR_SETTINGS_URL,
  normalizeMyAgentConnectors,
  type MyAgentConnector,
} from "@/lib/projects/myagent-source";
import { cn } from "@/lib/utils";

/**
 * MyAgent is intentionally not a normal SourceItemPicker: CAIPE cannot browse
 * the user's Outlook, Salesforce, or SharePoint data. The user authorizes a
 * bounded request here and configures the actual integrations in MyAgent's
 * own settings. The category list is not a CAIPE-enforced provider scope.
 */
export function MyAgentSourcePicker({
  selected,
  onChange,
  enabled,
  onEnabledChange,
  readOnly = false,
}: {
  selected: MyAgentConnector[];
  onChange: (next: MyAgentConnector[]) => void;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  readOnly?: boolean;
}) {
  const normalized = normalizeMyAgentConnectors(selected);
  const selectedSet = new Set(normalized);

  const toggle = (connector: MyAgentConnector) => {
    if (readOnly) return;
    const next = selectedSet.has(connector)
      ? normalized.filter((item) => item !== connector)
      : [...normalized, connector];
    // A changed request-category set needs a fresh, explicit opt-in; never
    // carry forward authorization granted for a different TOME request.
    if (enabled) onEnabledChange(false);
    onChange(normalizeMyAgentConnectors(next));
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <div className="flex items-start gap-3 border-b border-border/60 px-4 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#616BFA]/10 text-[#616BFA]">
          <Bot className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">MyAgent</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose which business-context categories TOME asks MyAgent about during ingestion.
          </p>
        </div>
      </div>

      <div className="space-y-2 p-4">
        {MYAGENT_CONNECTOR_OPTIONS.map((option) => {
          const checked = selectedSet.has(option.id);
          return (
            <label
              key={option.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                checked
                  ? "border-primary/45 bg-primary/5"
                  : "border-border/60 hover:bg-muted/40",
                readOnly && "cursor-default",
              )}
            >
              {readOnly ? (
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40",
                  )}
                  aria-hidden="true"
                >
                  {checked ? <Check className="h-3 w-3" /> : null}
                </span>
              ) : (
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(option.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
              )}
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {option.capabilities}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground/90">
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="border-t border-border/60 px-4 py-3">
        <label
          className={cn(
            "flex items-start gap-3 text-sm",
            readOnly || normalized.length === 0 ? "cursor-default" : "cursor-pointer",
            normalized.length === 0 && "text-muted-foreground",
          )}
        >
          {readOnly ? (
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                enabled
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40",
              )}
              aria-hidden="true"
            >
              {enabled ? <Check className="h-3 w-3" /> : null}
            </span>
          ) : (
            <input
              type="checkbox"
              checked={enabled}
              disabled={normalized.length === 0}
              onChange={(event) => onEnabledChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary disabled:cursor-not-allowed"
            />
          )}
          <span>
            <span className="font-medium text-foreground">
              I authorize TOME to send MyAgent a Webex request as me, naming these categories during ingestion.
            </span>
            {!enabled ? (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                No request will be sent until you opt in.
              </span>
            ) : (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Disconnect blocks a request that TOME has not yet claimed. A request already
                sent over Webex cannot be recalled; if Disconnect wins before the reply is
                consumed, TOME discards it. This does not disconnect the underlying connector
                in MyAgent settings, and scheduled auto-ingest never uses this permission.
              </span>
            )}
          </span>
        </label>
      </div>

      <div className="border-t border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <p className="flex gap-1.5 leading-5">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            First authorize these connectors in{" "}
            <a
              href={MYAGENT_CONNECTOR_SETTINGS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2"
            >
              MyAgent connector settings <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            . TOME&apos;s Webex backend sends a bounded one-time request naming the selected
            connector categories to MyAgent on your behalf using your Webex authorization.
            This selection limits what TOME asks for, but is not a CAIPE-enforced provider
            scope: MyAgent&apos;s settings and policy are the sole authorization boundary, and
            CAIPE cannot verify which connector produced a reply. CAIPE does not receive or
            manage those underlying credentials. A returned reply is untrusted external evidence:
            it is applied only in a restricted wiki-only follow-up pass, and every resulting
            report stays a private draft with no automatic promotion. Only you or a TOME
            administrator can explicitly approve it before its pages follow normal project
            sharing rules.
          </span>
        </p>
      </div>
    </section>
  );
}
