import { NextResponse } from "next/server";
import { LeaderboardReadError, parseLeaderboardRequest, readLeaderboard } from "@/lib/competition/scores";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";

export const runtime = "nodejs";
// Rankings change after server-authoritative finalization. Do not let a CDN
// replay a stale success or failure after a page transition; request bounds and
// the database projection remain the public-read controls.
const CACHE = { "Cache-Control": "no-store" } as const;

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
  } catch (error) {
    const reason = error instanceof LeaderboardReadError
      ? `leaderboard_${error.stage}_unavailable` as const
      : "database_operation_failed";
    logSecurityEvent({ eventType: "leaderboard.failed", route: "/api/leaderboard", requestId, reason, status: 500 });
    return NextResponse.json({ message: "Leaderboard is temporarily unavailable." }, { status: 500, headers: CACHE });
  }
}
