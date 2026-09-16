import { getCollection,isMongoDBConfigured } from "@/lib/mongodb";

export interface AppUsageEvent {
  user_email: string;
  occurred_at: Date;
}

/** Record one authenticated application-shell load for visitor analytics. */
export async function recordAppVisit(
  email: string,
  occurredAt = new Date(),
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !isMongoDBConfigured) return;

  const events = await getCollection<AppUsageEvent>("app_usage_events");
  await events.insertOne({ user_email: normalizedEmail, occurred_at: occurredAt });
}
