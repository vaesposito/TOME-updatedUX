"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h4 className="text-sm text-muted-foreground">{label}</h4>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
export function AnalyticsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
export const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const count = (value: number) => value.toLocaleString("en-US");
export const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export type SortDirection = "asc" | "desc";

export function compareOptionalDates(
  left: string | null | undefined,
  right: string | null | undefined,
  direction: SortDirection,
): number {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  const leftMissing = Number.isNaN(leftTime);
  const rightMissing = Number.isNaN(rightTime);
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return (direction === "asc" ? 1 : -1) * (leftTime - rightTime);
}

export function SortableTableHeader({
  label,
  active,
  direction,
  onSort,
  className = "p-3",
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onSort: () => void;
  className?: string;
}) {
  const nextDirection =
    active && direction === "desc" ? "ascending" : "descending";
  return (
    <th
      className={className}
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSort}
        aria-label={`Sort by ${label} ${nextDirection}`}
      >
        <span>{label}</span>
        {active ? (
          direction === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          )
        ) : (
          <ChevronsUpDown
            className="h-3.5 w-3.5 opacity-50"
            aria-hidden="true"
          />
        )}
      </button>
    </th>
  );
}

export function TomeActivityChart({
  daily,
}: {
  daily: Array<{
    date: string;
    activeUsers: number | null;
    tomeUsers: number | null;
    chatUsers: number;
  }>;
}) {
  return (
    <div
      className="rounded-lg border bg-card p-4"
      role="img"
      aria-label="Tome users, visitors, and chat users by day for the last 30 days"
    >
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart
          data={daily}
          margin={{ top: 8, right: 12, left: -15, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
          <XAxis
            dataKey="date"
            tickFormatter={dateLabel}
            tick={{ fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip
            labelFormatter={(value) => dateLabel(String(value))}
            contentStyle={{ background: "var(--popover)", borderRadius: 8 }}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="activeUsers"
            name="All users"
            stroke="hsl(210,90%,55%)"
            fill="hsl(210,90%,55%)"
            fillOpacity={0.12}
            strokeWidth={2}
            dot={{
              r: 5,
              fill: "hsl(210,90%,55%)",
              stroke: "var(--card)",
              strokeWidth: 2,
            }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="tomeUsers"
            name="Visitors"
            stroke="hsl(175,70%,42%)"
            strokeWidth={2}
            dot={{
              r: 3,
              fill: "hsl(175,70%,42%)",
              stroke: "var(--card)",
              strokeWidth: 1,
            }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="chatUsers"
            name="Chat users"
            stroke="hsl(275,75%,62%)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
