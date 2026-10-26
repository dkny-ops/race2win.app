import { hasEmptyBoundedBody } from "@/lib/competition/request-body";
import { recordCompetitionAccess, competitionAccessMessage } from "@/lib/security/competition-access";
import { recordAuth401, isGameAccessHeld, REVIEW_MESSAGE } from "@/lib/security/auth-401-review";
import { NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { GAMEPLAY_VERSION } from "@/lib/game/race-to-win";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";
import { RACE_TO_WIN_GAME_SLUG } from "@/lib/routes";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" };

function seedFromServer(): number {
  // Independent cryptographically random seed per official run. Persisted in
  // game_sessions for deterministic authoritative replay and historical audit.
  return randomInt(0x1_0000_0000);
}



export async function POST(request: Request) {
  const requestId = createSecurityRequestId();
  let failureStage = "authentication";
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ message: "Request unavailable." }, { status: 403, headers: CACHE });
    if (!await hasEmptyBoundedBody(request)) return NextResponse.json({ message: "Invalid request." }, { status: 400, headers: CACHE });
    const context = await getVerifiedUserContext();
    const userId = context?.userId ?? null;
    if (!userId) {
      logSecurityEvent({ eventType: "game_session.start.rejected", route: "/api/game-sessions/start", requestId, reason: "unauthenticated", status: 401 });
      const reference = await recordAuth401("/api/game-sessions/start", "unauthenticated");
      return NextResponse.json({ message: REVIEW_MESSAGE, reference }, { status: 401, headers: CACHE });
    }
    if (await isGameAccessHeld(userId)) return NextResponse.json({ message: REVIEW_MESSAGE, reviewRequired: true }, { status: 403, headers: CACHE });
    const { data: profile, error: profileError } = await context!.supabase.from("profiles").select("username").eq("user_id", userId).maybeSingle<{ username: string | null }>();
    if (profileError) throw profileError;
    if (!profile?.username) return NextResponse.json({ message: "Choose your player name before starting." }, { status: 403, headers: CACHE });
    if (!isAdminConfigured()) {
      logSecurityEvent({ eventType: "game_session.start.failed", route: "/api/game-sessions/start", requestId, reason: "missing_configuration", status: 503 });
      return NextResponse.json({ message: "Official sessions are unavailable." }, { status: 503, headers: CACHE });
    }

    failureStage = "terms";
    const { data: consent, error: consentError } = await createAdminClient()
      .from("player_terms_acceptances").select("terms_version")
      .eq("player_id", userId).maybeSingle();
    if (consentError) throw consentError;
    if (consent?.terms_version !== "2026-10-18") {
      return NextResponse.json({ message: "Accept the Terms of Use before entering official tournaments.", redirectTo: "/terms/accept" }, { status: 403, headers: CACHE });
    }

    // The database serializes the verified player's count-and-insert under an
    // advisory transaction lock, which remains correct across server instances.
    const access = await recordCompetitionAccess(userId, "race-to-win", request);
    if (access !== "allowed") return NextResponse.json({ message: competitionAccessMessage(access), code: access }, { status: access === "unavailable" ? 503 : 403, headers: CACHE });
    failureStage = "session_rpc";
    const { data, error } = await createAdminClient().rpc("rtw_start_official_game_session_v3", {
      p_player_id: userId,
      p_game_slug: RACE_TO_WIN_GAME_SLUG,
      p_gameplay_version: GAMEPLAY_VERSION,
      p_seed: seedFromServer(),
    });
    if (error) {
      logSecurityEvent({ eventType: "game_session.start.failed", route: "/api/game-sessions/start", requestId, reason: "database_operation_failed", status: 503 });
      if (error.code === "P0001" && error.message === "Hourly official opportunities exhausted.") {
        logSecurityEvent({ eventType: "game_session.start.rejected", route: "/api/game-sessions/start", requestId, reason: "rate_limited", status: 429 });
        return NextResponse.json({ message: "Usaste tus 5 oportunidades de esta hora. Se renuevan al inicio de la próxima hora; no se acumulan." }, { status: 429, headers: CACHE });
      }
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
      !Number.isSafeInteger(Number(session.checkpoint_interval_score)) ||
      Number(session.checkpoint_interval_score) < 1 ||
      typeof session.activity_lease_expires_at !== "string" ||
      !Number.isSafeInteger(Number(session.seed))
    ) {
      throw new Error("Unexpected official session response");
    }
    failureStage = "human_check_rpc";
    const { data: created, error: creationError } = await createAdminClient().rpc("rtw_create_human_check", {
      p_session_id: session.id, p_player_id: userId,
      p_delay_seconds: randomInt(60, 101), p_target: randomInt(0, 4),
    });
    if (creationError || created !== true) {
      logSecurityEvent({ eventType: "game_session.start.failed", route: "/api/game-sessions/start", requestId, reason: "database_operation_failed", status: 503 });
      throw new Error("challenge_unavailable");
    }
    return NextResponse.json({
      sessionId: session.id,
      gameId: RACE_TO_WIN_GAME_SLUG,
      gameplayVersion: session.gameplay_version,
      seed: session.seed,
      startsAt: session.started_at,
      expiresAt: session.expires_at,
      checkpointInterval: Number(session.checkpoint_interval_score),
      activityLeaseExpiresAt: session.activity_lease_expires_at,
    }, { headers: CACHE });
  } catch {
    logSecurityEvent({ eventType: "game_session.start.failed", route: "/api/game-sessions/start", requestId, reason: "database_operation_failed", status: 503 });
    return NextResponse.json({ message: "Official sessions are unavailable." }, { status: 503, headers: CACHE });
  }
}
