import { NextResponse } from "next/server";
import { parseLeaderboardRequest, readLeaderboard } from "@/lib/competition/scores";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";

export const runtime = "nodejs";
// CDN caching is the multi-instance-safe guard for a public, non-mutating
// board. The origin only accepts bounded, allowlisted query parameters.
const CACHE = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } as const;

export async function GET(request: Request) {
  const requestId = createSecurityRequestId();
  try {
    const params = parseLeaderboardRequest(new URL(request.url).searchParams);
    if (!params) {
      logSecurityEvent({ eventType: "leaderboard.rejected", route: "/api/leaderboard", requestId, reason: "invalid_request", status: 400 });
      return NextResponse.json({ message: "Invalid leaderboard request." }, { status: 400, headers: CACHE });
    }
    if (!isAdminConfigured()) {
      logSecurityEvent({ eventType: "leaderboard.failed", route: "/api/leaderboard", requestId, reason: "missing_configuration", status: 503 });
      return NextResponse.json({ message: "Leaderboard is temporarily unavailable." }, { status: 503, headers: CACHE });
    }
    return NextResponse.json(await readLeaderboard(params), { headers: CACHE });
  } catch {
    logSecurityEvent({ eventType: "leaderboard.failed", route: "/api/leaderboard", requestId, reason: "database_operation_failed", status: 500 });
    return NextResponse.json({ message: "Leaderboard is temporarily unavailable." }, { status: 500, headers: CACHE });
  }
}
