import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import {
  getIngestionBudget,
  saveIngestionBudget,
  validateBudgetSettings,
} from "@/lib/tome/ingestion-budget";

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTomeAdmin(session)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let settings;
  try {
    settings = validateBudgetSettings(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid budget settings",
      },
      { status: 400 },
    );
  }
  try {
    await saveIngestionBudget(settings, session.user.email);
    auditTome({
      action: "tome.analytics.budget.update",
      actor: tomeActorFromAuth({ user: session.user, session }),
      projectSlug: "global",
      metadata: { ...settings },
    });
    return NextResponse.json({ data: await getIngestionBudget() });
  } catch (error) {
    console.error("[tome-analytics] budget update failed", error);
    return NextResponse.json(
      {
        error:
          "Unable to save or reload the ingestion budget. Refresh to check the saved value.",
      },
      { status: 503 },
    );
  }
}
