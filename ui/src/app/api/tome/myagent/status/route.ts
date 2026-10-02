import { NextResponse } from "next/server";

import { getMyAgentWebexConfig } from "@/lib/tome/myagent-webex";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { enabled: getMyAgentWebexConfig().enabled },
    { headers: { "Cache-Control": "no-store" } },
  );
}
