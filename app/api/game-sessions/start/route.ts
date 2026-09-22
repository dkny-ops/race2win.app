import { NextResponse } from "next/server";
import { GAMEPLAY_VERSION } from "@/lib/game/race-to-win";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";
import { RACE_TO_WIN_GAME_SLUG } from "@/lib/routes";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" };

function seedFromServer(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

async function verifiedUserId(): Promise<string | null> {
  return (await getVerifiedUserContext())?.userId ?? null;
}

export async function POST() {
  const requestId = createSecurityRequestId();
  try {
    const userId = await verifiedUserId();
    if (!userId) {
      logSecurityEvent({ eventType: "game_session.start.rejected", route: "/api/game-sessions/start", requestId, reason: "unauthenticated", status: 401 });
      return NextResponse.json({ message: "Sign in to start an official session." }, { status: 401, headers: CACHE });
    }
    if (!isAdminConfigured()) {
      logSecurityEvent({ eventType: "game_session.start.failed", route: "/api/game-sessions/start", requestId, reason: "missing_configuration", status: 503 });
      return NextResponse.json({ message: "Official sessions are unavailable." }, { status: 503, headers: CACHE });
    }

    // The database serializes the verified player's count-and-insert under an
    // advisory transaction lock, which remains correct across server instances.
    const { data, error } = await createAdminClient().rpc("rtw_start_official_game_session_v2", {
      p_player_id: userId,
      p_game_slug: RACE_TO_WIN_GAME_SLUG,
      p_gameplay_version: GAMEPLAY_VERSION,
      p_seed: seedFromServer(),
    });
    if (error) {
      if (error.code === "P0001" && error.message === "Official session start rate limit exceeded.") {
        logSecurityEvent({ eventType: "game_session.start.rejected", route: "/api/game-sessions/start", requestId, reason: "rate_limited", status: 429 });
        return NextResponse.json({ message: "Please wait before starting another session." }, { status: 429, headers: CACHE });
      }
      throw error;
    }
    const session = Array.isArray(data) ? data[0] : null;
    if (
      !session ||
      typeof session.id !== "string" ||
      typeof session.gameplay_version !== "string" ||
      typeof session.started_at !== "string" ||
      typeof session.expires_at !== "string" ||
      !Number.isSafeInteger(Number(session.seed))
    ) {
      throw new Error("Unexpected official session response");
    }
    return NextResponse.json({
      sessionId: session.id,
      gameId: RACE_TO_WIN_GAME_SLUG,
      gameplayVersion: session.gameplay_version,
      seed: session.seed,
      startsAt: session.started_at,
      expiresAt: session.expires_at,
    }, { headers: CACHE });
  } catch {
    logSecurityEvent({ eventType: "game_session.start.failed", route: "/api/game-sessions/start", requestId, reason: "database_operation_failed", status: 503 });
    return NextResponse.json({ message: "Official sessions are unavailable." }, { status: 503, headers: CACHE });
  }
}
