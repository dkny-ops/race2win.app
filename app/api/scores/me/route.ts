import { NextResponse } from "next/server";
import { getVerifiedPlayerId } from "@/lib/competition/server";
import { readPersonalScores } from "@/lib/competition/scores";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  const requestId = createSecurityRequestId();
  try {
    const playerId = await getVerifiedPlayerId();
    if (!playerId) {
      logSecurityEvent({ eventType: "scores.me.rejected", route: "/api/scores/me", requestId, reason: "unauthenticated", status: 401 });
      return NextResponse.json({ message: "Sign in to view your scores." }, { status: 401, headers: CACHE });
    }
    if (!isAdminConfigured()) {
      logSecurityEvent({ eventType: "scores.me.failed", route: "/api/scores/me", requestId, reason: "missing_configuration", status: 503 });
      return NextResponse.json({ message: "Scores are temporarily unavailable." }, { status: 503, headers: CACHE });
    }
    return NextResponse.json(await readPersonalScores(playerId), { headers: CACHE });
  } catch {
    logSecurityEvent({ eventType: "scores.me.failed", route: "/api/scores/me", requestId, reason: "database_operation_failed", status: 500 });
    return NextResponse.json({ message: "Scores are temporarily unavailable." }, { status: 500, headers: CACHE });
  }
}
