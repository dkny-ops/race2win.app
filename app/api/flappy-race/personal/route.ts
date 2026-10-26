import { NextResponse } from "next/server";
import { getVerifiedPlayerId } from "@/lib/competition/server";
import { readFlappyPersonalWeek } from "@/lib/competition/flappy-personal-score";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const requestId = createSecurityRequestId();
  try {
    const playerId = await getVerifiedPlayerId();
    if (!playerId) {
      logSecurityEvent({ eventType: "flappy.personal.rejected", route: "/api/flappy-race/personal", requestId, reason: "unauthenticated", status: 401 });
      return NextResponse.json({ message: "Sign in to view your FlappyRace score." }, { status: 401, headers });
    }
    if (!isAdminConfigured()) {
      logSecurityEvent({ eventType: "flappy.personal.failed", route: "/api/flappy-race/personal", requestId, reason: "missing_configuration", status: 503 });
      return NextResponse.json({ message: "Personal score is temporarily unavailable." }, { status: 503, headers });
    }
    return NextResponse.json(await readFlappyPersonalWeek(playerId), { headers });
  } catch {
    logSecurityEvent({ eventType: "flappy.personal.failed", route: "/api/flappy-race/personal", requestId, reason: "read_failed", status: 503 });
    return NextResponse.json({ message: "Personal score is temporarily unavailable." }, { status: 503, headers });
  }
}
