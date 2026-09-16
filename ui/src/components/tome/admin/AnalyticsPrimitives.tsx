"use client";

import type { ReactNode } from "react";
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
      aria-label="Daily Tome active users, visitors, and chat users for the last 30 UTC dates"
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
            name="Tome active users"
            stroke="hsl(210,90%,55%)"
            fill="hsl(210,90%,55%)"
            fillOpacity={0.12}
            strokeWidth={2}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="tomeUsers"
            name="Tome visitors"
            stroke="hsl(175,70%,42%)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="chatUsers"
            name="Tome chat users"
            stroke="hsl(275,75%,62%)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
