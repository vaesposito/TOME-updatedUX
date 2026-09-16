"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IngestionBudgetAnalytics } from "@/lib/tome/ingestion-budget";
import {
  AnalyticsSection,
  count,
  dateLabel,
  Metric,
  money,
} from "./AnalyticsPrimitives";

export function TomeBudgetPanel({
  budget,
  onSaved,
}: {
  budget: IngestionBudgetAnalytics | null;
  onSaved: (budget: IngestionBudgetAnalytics) => void;
}) {
  const [limit, setLimit] = useState(budget?.monthlyLimitUsd?.toString() ?? "");
  const [threshold, setThreshold] = useState(
    String(budget?.alertAtPercent ?? 80),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/tome/admin/analytics/budget", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyLimitUsd: limit.trim() ? Number(limit) : null,
          alertAtPercent: Number(threshold),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to save budget");
      onSaved(body.data);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save budget");
    } finally {
      setSaving(false);
    }
  }
  if (!budget)
    return (
      <p role="status" className="py-8 text-muted-foreground">
        Budget data is unavailable. Refresh to try again.
      </p>
    );
  const status =
    budget.status === "over_budget"
      ? "Monthly budget reached"
      : budget.status === "near_limit"
        ? "Approaching monthly budget"
        : budget.status === "not_configured"
          ? "No monthly budget configured"
          : "Recorded spend is within budget";
  return (
    <div className="space-y-6">
      <AnalyticsSection
        title="Ingestion budget"
        description={`${budget.month} · Runs started ${dateLabel(budget.periodStart)}–${dateLabel(new Date(new Date(budget.periodEnd).getTime() - 1).toISOString())} (UTC). Includes source ingestion and Area/BHAG synthesis.`}
      >
        <div
          role="status"
          className={`rounded-lg border p-3 text-sm ${budget.status === "over_budget" || budget.status === "near_limit" ? "border-amber-500/60 bg-amber-500/10" : "bg-muted/30"}`}
        >
          {status}. Monitoring only: exceeding the limit does not stop
          ingestion.
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="Monthly budget"
            value={
              budget.monthlyLimitUsd === null
                ? "Not configured"
                : money(budget.monthlyLimitUsd)
            }
          />
          <Metric
            label="Recorded spend"
            value={money(budget.spentUsd)}
            detail={`${budget.measuredRuns} of ${budget.runs} runs report cost`}
          />
          <Metric
            label="Remaining budget"
            value={
              budget.remainingUsd === null ? "—" : money(budget.remainingUsd)
            }
            detail={
              budget.utilizationPercent === null
                ? undefined
                : `${budget.utilizationPercent.toFixed(1)}% used`
            }
          />
        </div>
        {budget.utilizationPercent !== null && (
          <progress
            aria-label="Monthly budget used"
            className="h-2 w-full accent-primary"
            value={Math.min(budget.utilizationPercent, 100)}
            max={100}
          />
        )}
        <p className="text-sm text-muted-foreground">
          {budget.unmeasuredRuns > 0
            ? `${budget.unmeasuredRuns} runs have unknown cost; spend is incomplete and remaining budget may be overstated.`
            : "All current-month runs report cost."}{" "}
          {budget.pendingRuns} runs are queued, running, or awaiting review.
          In-flight cost may increase.
        </p>
      </AnalyticsSection>
      <AnalyticsSection
        title="Budget settings"
        description="Organization-wide monthly USD limit. Leave blank to remove it. Warnings appear here at the configured threshold."
      >
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            Monthly budget (USD)
            <Input
              type="number"
              min="0.01"
              max="1000000000"
              step="0.01"
              placeholder="Not configured"
              value={limit}
              disabled={saving}
              onChange={(event) => {
                setLimit(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label className="space-y-1 text-sm">
            Warn at (%)
            <Input
              type="number"
              min="1"
              max="100"
              step="1"
              required
              value={threshold}
              disabled={saving}
              onChange={(event) => {
                setThreshold(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save budget"}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-emerald-600">
            Budget saved.
          </p>
        )}
      </AnalyticsSection>
      <AnalyticsSection
        title="Spend by entity"
        description="Recorded agent costs, including failed runs when cost is known. Archived and removed entities remain in budget accounting."
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3">Entity</th>
                <th className="p-3">Source ingestion</th>
                <th className="p-3">Synthesis</th>
                <th className="p-3">Cost coverage</th>
              </tr>
            </thead>
            <tbody>
              {budget.byEntity.map((row) => (
                <tr key={row.projectId} className="border-t">
                  <td className="p-3">
                    {row.slug ? (
                      <Link
                        className="hover:underline"
                        href={`/projects/${encodeURIComponent(row.slug)}/tome/ingest`}
                      >
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.type}
                    </span>
                  </td>
                  <td className="p-3 tabular-nums">
                    {money(row.ingestionUsd)}
                  </td>
                  <td className="p-3 tabular-nums">
                    {money(row.synthesisUsd)}
                  </td>
                  <td className="p-3">
                    {row.measuredRuns}/{row.runs} runs
                  </td>
                </tr>
              ))}
              {budget.byEntity.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No ingestion runs started this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          {count(budget.inputTokens)} input tokens ·{" "}
          {count(budget.outputTokens)} output tokens. Costs are attributed to
          the month the run started; this is not a provider invoice. Chat and
          separate evaluation costs are excluded.
        </p>
      </AnalyticsSection>
    </div>
  );
}
