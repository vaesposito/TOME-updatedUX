import type {
  OrgConsumptionResult,
  TomeFreshness,
  TomeLeadershipKpis,
  TomePerformance,
  TomeUptime,
} from "./analytics";
import type { TomeChatAnalytics } from "./chat-analytics";
import type { IngestionBudgetAnalytics } from "./ingestion-budget";
import type { TomeUsageAnalytics } from "./usage-analytics";

type Serialized<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export interface TomeAnalyticsSnapshot {
  chat: TomeChatAnalytics | null;
  budget: IngestionBudgetAnalytics | null;
  usage: Serialized<TomeUsageAnalytics> | null;
  leadership: TomeLeadershipKpis | null;
  freshness: TomeFreshness | null;
  performance: TomePerformance | null;
  uptime: TomeUptime | null;
  projects: Serialized<OrgConsumptionResult["rows"]>;
  errors: Partial<
    Record<
      | "chat"
      | "budget"
      | "usage"
      | "leadership"
      | "freshness"
      | "performance"
      | "uptime"
      | "consumption",
      string
    >
  >;
}
