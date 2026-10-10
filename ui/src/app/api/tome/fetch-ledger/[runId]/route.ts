// External, API-key-authenticated retrieval of a run's fetch ledger (FR-012).
// Consumers outside Tome — e.g. the companion evaluation system in
// docs/docs/evaluations/tome_external_eval_design.md — read this instead of
// needing direct database access. See contracts/external-fetch-ledger-api.md.

import { NextRequest, NextResponse } from "next/server";

import { getAuthFromBearerOrSession } from "@/lib/api-middleware";
import { canReadTomeProject } from "@/lib/tome/access";
import { getFetchLedgerEntries, getRunLedgerSummary } from "@/lib/tome/fetch-ledger-store";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { resolveProject } from "@/lib/tome/internal-api";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ runId: string }> };

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: Ctx): Promise<NextResponse> {
  if (!isTomeServerEnabled()) return errorResponse("Not found", 404);

  const { runId } = await context.params;

  let sub: string;
  try {
    const { session } = await getAuthFromBearerOrSession(request);
    requireInteractiveTomePrincipal(session);
    sub = session.sub ?? "";
    if (!sub) return errorResponse("Unauthorized", 401);
  } catch {
    return errorResponse("Unauthorized", 401);
  }

  const summary = await getRunLedgerSummary(runId);
  if (!summary) return errorResponse(`No fetch ledger found for run ${runId}`, 404);

  const project = await resolveProject(summary.project_id).catch(() => null);
  if (!project) return errorResponse(`No fetch ledger found for run ${runId}`, 404);

  const allowed = await canReadTomeProject(sub, project);
  if (!allowed) return errorResponse("Forbidden", 403);

  const entries = await getFetchLedgerEntries(runId);
  return NextResponse.json({
    run_id: runId,
    project_id: summary.project_id,
    summary: {
      fetch_count: summary.fetch_count,
      success_count: summary.success_count,
      total_bytes_fetched: summary.total_bytes_fetched,
    },
    entries,
  });
}
