"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IngestionBudgetAnalytics } from "@/lib/tome/ingestion-budget";
import {
  AnalyticsSection,
  dateLabel,
  Metric,
  money,
  type SortDirection,
  SortableTableHeader,
} from "./AnalyticsPrimitives";

type SpendSortKey = "ingestionUsd" | "synthesisUsd" | "coverage";

const updateCount = (value: number) =>
  `${value.toLocaleString("en-US")} update${value === 1 ? "" : "s"}`;

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
  const [spendSort, setSpendSort] = useState<{
    key: SpendSortKey;
    direction: SortDirection;
  } | null>(null);
  const sortedEntities = useMemo(() => {
    const rows = budget?.byEntity ?? [];
    if (!spendSort) return rows;
    const direction = spendSort.direction === "asc" ? 1 : -1;
    const value = (row: IngestionBudgetAnalytics["byEntity"][number]) => {
      if (spendSort.key === "coverage")
        return row.runs === 0 ? 0 : row.measuredRuns / row.runs;
      return row[spendSort.key];
    };
    return [...rows].sort(
      (a, b) =>
        direction * (value(a) - value(b)) || a.name.localeCompare(b.name),
    );
  }, [budget?.byEntity, spendSort]);
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
      ? "This month's budget has been reached"
      : budget.status === "near_limit"
        ? "Spending is close to this month's budget"
        : budget.status === "not_configured"
          ? "No monthly budget is set"
          : "Spending is within this month's budget";
  const month = new Date(budget.periodStart).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const sortSpendBy = (key: SpendSortKey) => {
    setSpendSort((current) => ({
      key,
      direction:
        current?.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };
  return (
    <div className="space-y-6">
      <AnalyticsSection
        title="Monthly content budget"
        description={`${month} · Covers source updates and Area or BHAG summaries started from ${dateLabel(budget.periodStart)} through ${dateLabel(new Date(new Date(budget.periodEnd).getTime() - 1).toISOString())}.`}
      >
        <div
          role="status"
          className={`rounded-lg border p-3 text-sm ${budget.status === "over_budget" || budget.status === "near_limit" ? "border-amber-500/60 bg-amber-500/10" : "bg-muted/30"}`}
        >
          {status}. Content updates continue when the budget is reached.
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="Monthly limit"
            value={
              budget.monthlyLimitUsd === null
                ? "Not set"
                : money(budget.monthlyLimitUsd)
            }
          />
          <Metric
            label="Spent so far"
            value={money(budget.spentUsd)}
            detail={`${budget.measuredRuns} of ${budget.runs} updates include cost`}
          />
          <Metric
            label="Available"
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
            ? `${updateCount(budget.unmeasuredRuns)} ${budget.unmeasuredRuns === 1 ? "does" : "do"} not include cost yet, so the total and available amount may change.`
            : "All updates this month include cost."}{" "}
          {updateCount(budget.pendingRuns)}{" "}
          {budget.pendingRuns === 1 ? "is" : "are"} still in progress or waiting
          for review, so the total may increase.
        </p>
      </AnalyticsSection>
      <AnalyticsSection
        title="Set a monthly budget"
        description="Choose a spending target for Tome content updates and when to show a warning. The budget sends warnings but does not pause updates. Leave the limit blank to track spending without a budget."
      >
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            Monthly limit (USD)
            <Input
              type="number"
              min="0.01"
              max="1000000000"
              step="0.01"
              placeholder="No limit"
              value={limit}
              disabled={saving}
              onChange={(event) => {
                setLimit(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label className="space-y-1 text-sm">
            Show warning at (%)
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
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-emerald-600">
            Budget updated.
          </p>
        )}
      </AnalyticsSection>
      <AnalyticsSection
        title="Spending by project, Area, and BHAG"
        description="See where content update costs came from this month. Archived or removed items remain here so the monthly total stays accurate."
      >
        <div className="overflow-x-auto rounded-lg border">
          <table
            className="w-full text-sm"
            aria-label="Spending by project, Area, and BHAG"
          >
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3">Name</th>
                <SortableTableHeader
                  label="Source updates"
                  active={spendSort?.key === "ingestionUsd"}
                  direction={spendSort?.direction ?? "desc"}
                  onSort={() => sortSpendBy("ingestionUsd")}
                />
                <SortableTableHeader
                  label="Area and BHAG summaries"
                  active={spendSort?.key === "synthesisUsd"}
                  direction={spendSort?.direction ?? "desc"}
                  onSort={() => sortSpendBy("synthesisUsd")}
                />
                <SortableTableHeader
                  label="Updates with costs"
                  active={spendSort?.key === "coverage"}
                  direction={spendSort?.direction ?? "desc"}
                  onSort={() => sortSpendBy("coverage")}
                />
              </tr>
            </thead>
            <tbody>
              {sortedEntities.map((row) => (
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
                      {row.type === "bhag"
                        ? "BHAG"
                        : row.type === "area"
                          ? "Area"
                          : "Project"}
                    </span>
                  </td>
                  <td className="p-3 tabular-nums">
                    {money(row.ingestionUsd)}
                  </td>
                  <td className="p-3 tabular-nums">
                    {money(row.synthesisUsd)}
                  </td>
                  <td className="p-3">
                    {row.measuredRuns} of {row.runs}
                  </td>
                </tr>
              ))}
              {budget.byEntity.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No content updates started this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Totals are estimates for content updates started this month. Your
          provider bill may differ. Chat and model evaluation costs are not
          included.
        </p>
      </AnalyticsSection>
    </div>
  );
}
