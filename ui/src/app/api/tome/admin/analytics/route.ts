// TOME admin analytics. Independent sources report unavailability explicitly.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import {
  getOrgTomeConsumption,
  getTomeFreshness,
  getTomeLeadershipKpis,
  getTomeQueryLatencyP95,
  getTomeUptime,
} from "@/lib/tome/analytics";
import type { TomeAnalyticsSnapshot } from "@/lib/tome/analytics-types";
import { getTomeChatAnalytics } from "@/lib/tome/chat-analytics";
import { getIngestionBudget } from "@/lib/tome/ingestion-budget";
import { getTomeUsageAnalytics } from "@/lib/tome/usage-analytics";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTomeAdmin(session)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const errors: TomeAnalyticsSnapshot["errors"] = {};
  async function read<T>(
    section: keyof typeof errors,
    load: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await load();
    } catch (error) {
      console.error(`[tome-analytics] ${section} unavailable`, error);
      errors[section] = `${section} analytics are temporarily unavailable.`;
      return null;
    }
  }
  const [
    chat,
    budget,
    usage,
    leadership,
    freshness,
    performance,
    uptime,
    consumption,
  ] = await Promise.all([
    read("chat", () => getTomeChatAnalytics()),
    read("budget", () => getIngestionBudget()),
    read("usage", () => getTomeUsageAnalytics()),
    read("leadership", () => getTomeLeadershipKpis()),
    read("freshness", () => getTomeFreshness()),
    read("performance", () => getTomeQueryLatencyP95()),
    read("uptime", () => getTomeUptime()),
    read("consumption", () => getOrgTomeConsumption()),
  ]);
  return NextResponse.json({
    data: {
      chat,
      budget,
      usage,
      leadership,
      freshness,
      performance,
      uptime,
      projects: consumption?.rows ?? [],
      errors,
    },
  });
}
