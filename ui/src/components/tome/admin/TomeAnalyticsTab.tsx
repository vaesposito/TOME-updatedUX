"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TomeAnalyticsSnapshot } from "@/lib/tome/analytics-types";
import { TomeBudgetPanel } from "./TomeBudgetPanel";
import { TomeContentPanel } from "./TomeContentPanel";
import { TomeUsagePanel } from "./TomeUsagePanel";

export function TomeAnalyticsTab() {
  const [data, setData] = useState<TomeAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tome/admin/analytics");
      const body = await response.json();
      if (!response.ok || !body.data)
        throw new Error(body.error || "Unable to load analytics");
      setData(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tome analytics</h2>
          <p className="text-sm text-muted-foreground">
            See how people use Tome, what they read, and where conversations
            happen.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {error}
          {data && " Previously loaded data is shown below."}
        </p>
      )}
      {loading && !data && (
        <p role="status" className="py-12 text-center text-muted-foreground">
          Loading analytics…
        </p>
      )}
      {data && (
        <>
          {Object.entries(data.errors).map(([section, message]) => (
            <p
              role="alert"
              key={section}
              className="rounded-md border border-amber-500/40 p-3 text-sm"
            >
              {message} Other sections remain available.
            </p>
          ))}
          <Tabs defaultValue="usage">
            <TabsList aria-label="Analytics sections">
              <TabsTrigger value="usage">Usage</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="budget">Budget</TabsTrigger>
            </TabsList>
            <TabsContent value="usage" className="mt-5">
              <TomeUsagePanel chat={data.chat} usage={data.usage} />
            </TabsContent>
            <TabsContent value="content" className="mt-5">
              <TomeContentPanel data={data} />
            </TabsContent>
            <TabsContent value="budget" className="mt-5">
              <TomeBudgetPanel
                budget={data.budget}
                onSaved={(budget) =>
                  setData((current) =>
                    current ? { ...current, budget } : current,
                  )
                }
              />
            </TabsContent>
          </Tabs>
          {data.chat && (
            <p className="text-xs text-muted-foreground">
              Updated {new Date(data.chat.asOf).toLocaleString()}. People are
              counted once even if they use more than one project.
            </p>
          )}
        </>
      )}
    </div>
  );
}
