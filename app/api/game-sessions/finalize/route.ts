import { NextResponse } from "next/server";
import {
  MAX_OFFICIAL_INPUTS,
  isAuthoritativeGameplayVersion,
  replayAuthoritativeRace,
  type LaneInputEvent,
} from "@/lib/game/race-to-win";
import { checkpointCountForScore, digestOfficialInputs, isCheckpointInterval, proofMatchesInputs, type StoredCheckpointProof } from "@/lib/game/race-to-win/checkpoints";
import { OFFICIAL_SESSION_UUID, parseOfficialInputs, readOfficialSessionJson } from "@/lib/game/race-to-win/official-inputs";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" };

type FinalizeBody = { sessionId: string; inputs: LaneInputEvent[] };

type StoredOfficialOutcome = {
  readonly final_score: number | null;
  readonly final_distance_millimeters: number | null;
  readonly final_elapsed_ms: number | null;
  readonly final_collision_at_ms: number | null;
};

async function verifiedUserId(): Promise<string | null> {
  return (await getVerifiedUserContext())?.userId ?? null;
}

function parseBody(value: unknown): FinalizeBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || typeof body.sessionId !== "string" || !OFFICIAL_SESSION_UUID.test(body.sessionId)) return null;
  const inputs = parseOfficialInputs(body.inputs, MAX_OFFICIAL_INPUTS);
  if (!inputs) return null;
  return { sessionId: body.sessionId, inputs };
}

function officialOutcome(session: StoredOfficialOutcome) {
  return {
    score: session.final_score,
    distanceMillimeters: session.final_distance_millimeters,
    elapsedMs: session.final_elapsed_ms,
    collisionAtMs: session.final_collision_at_ms,
  };
}

export async function POST(request: Request) {
  const requestId = createSecurityRequestId();
  try {
    const body = parseBody(await readOfficialSessionJson(request));
    if (!body) {
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/finalize", requestId, reason: "invalid_request", status: 400 });
      return NextResponse.json({ message: "Invalid run record." }, { status: 400, headers: CACHE });
    }
    const userId = await verifiedUserId();
    if (!userId) {
      logSecurityEvent({ eventType: "game_session.finalize.rejected", route: "/api/game-sessions/finalize", requestId, reason: "unauthenticated", status: 401 });
      return NextResponse.json({ message: "Sign in to finalize an official session." }, { status: 401, headers: CACHE });
    }
    if (!isAdminConfigured()) {
      logSecurityEvent({ eventType: "game_session.finalize.failed", route: "/api/game-sessions/finalize", requestId, reason: "missing_configuration", status: 503 });
      return NextResponse.json({ message: "Official sessions are unavailable." }, { status: 503, headers: CACHE });
    }

    const admin = createAdminClient();
    const { data: session, error } = await admin
      .from("game_sessions")
      .select("id, user_id, gameplay_version, seed, status, started_at, expires_at, activity_lease_expires_at, checkpoint_interval_score, finalized_at, input_digest, input_count, final_score, final_distance_millimeters, final_elapsed_ms, final_collision_at_ms")
      .eq("id", body.sessionId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!session) {
      logSecurityEvent({ eventType: "game_session.finalize.rejected", route: "/api/game-sessions/finalize", requestId, reason: "session_not_found", status: 404 });
      return NextResponse.json({ message: "Session unavailable." }, { status: 404, headers: CACHE });
    }
    if (!isAuthoritativeGameplayVersion(session.gameplay_version)) {
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/finalize", requestId, reason: "gameplay_version_rejected", status: 409 });
      return NextResponse.json({ message: "Session unavailable." }, { status: 409, headers: CACHE });
    }

    const digest = digestOfficialInputs(body.inputs);
    if (session.status === "finalized") {
      if (session.input_digest !== digest) {
        logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/finalize", requestId, reason: "finalize_conflict", status: 409 });
        return NextResponse.json({ message: "Session already finalized." }, { status: 409, headers: CACHE });
      }
      return NextResponse.json(officialOutcome(session), { headers: CACHE });
    }
    if (session.status !== "active" || !isCheckpointInterval(session.checkpoint_interval_score)) {
      logSecurityEvent({ eventType: "game_session.finalize.rejected", route: "/api/game-sessions/finalize", requestId, reason: "session_not_active", status: 409 });
      return NextResponse.json({ message: "Session unavailable." }, { status: 409, headers: CACHE });
    }
    const elapsedCapMs = Math.max(0, Math.floor(Date.now() - Date.parse(session.started_at)));
    const replay = replayAuthoritativeRace(session.gameplay_version, Number(session.seed), body.inputs, elapsedCapMs);
    if (!replay) {
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/finalize", requestId, reason: "replay_rejected", status: 409 });
      return NextResponse.json({ message: "Run record is not yet finalizable." }, { status: 409, headers: CACHE });
    }
    const checkpointInterval = Number(session.checkpoint_interval_score);
    const expectedCheckpointCount = checkpointCountForScore(replay.score, checkpointInterval);
    const { data: existingCheckpoints, error: checkpointReadError } = await admin.rpc("rtw_read_game_session_checkpoint_proofs", {
      p_session_id: session.id,
      p_player_id: userId,
    });
    if (checkpointReadError) throw checkpointReadError;
    const proofs = (existingCheckpoints ?? []) as StoredCheckpointProof[];
    if (
      proofs.some((proof) => !proofMatchesInputs(proof, body.inputs, checkpointInterval)) ||
      proofs.some((proof) => proof.checkpoint_index > expectedCheckpointCount)
    ) {
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/finalize", requestId, reason: "finalize_conflict", status: 409 });
      return NextResponse.json({ message: "Run record conflicts with checkpoint evidence." }, { status: 409, headers: CACHE });
    }
    const checkpointProofs = proofs.map((proof) => ({
      checkpointIndex: proof.checkpoint_index,
      inputCount: proof.proof_input_count,
      inputDigest: digestOfficialInputs(body.inputs.slice(0, proof.proof_input_count)),
    }));
    // The database function locks the session, validates every existing proof,
    // backfills only replay-proven missing milestones, then changes status in
    // one transaction. This closes the read/check/update race with concurrent
    // checkpoint requests.
    const { data: finalizedRows, error: finalizeError } = await admin.rpc("rtw_finalize_game_session_with_checkpoints", {
      p_session_id: session.id,
      p_player_id: userId,
      p_input_digest: digest,
      p_input_count: body.inputs.length,
      p_final_score: replay.score,
      p_final_distance_millimeters: replay.distanceMillimeters,
      p_final_elapsed_ms: replay.elapsedMs,
      p_final_collision_at_ms: replay.collisionAtMs,
      p_checkpoint_proofs: checkpointProofs,
    });
    if (finalizeError) {
      if (finalizeError.code === "23514" || finalizeError.code === "P0002") {
        logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/finalize", requestId, reason: "finalize_conflict", status: 409 });
        return NextResponse.json({ message: "Run record conflicts with checkpoint evidence." }, { status: 409, headers: CACHE });
      }
      throw finalizeError;
    }
    const finalizedSession = finalizedRows?.[0] ?? null;
    if (finalizedSession) return NextResponse.json(officialOutcome(finalizedSession), { headers: CACHE });

    // The conditional status transition is the database-level arbiter. If a
    // concurrent request won, return only the stored canonical result for an
    // exact retry; a different replay must not appear to have succeeded.
    const { data: canonicalSession, error: canonicalError } = await admin
      .from("game_sessions")
      .select("status, input_digest, final_score, final_distance_millimeters, final_elapsed_ms, final_collision_at_ms")
      .eq("id", session.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (canonicalError) throw canonicalError;
    if (canonicalSession?.status === "finalized" && canonicalSession.input_digest === digest) {
      return NextResponse.json(officialOutcome(canonicalSession), { headers: CACHE });
    }
    logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/finalize", requestId, reason: "finalize_conflict", status: 409 });
    return NextResponse.json({ message: "Session already finalized." }, { status: 409, headers: CACHE });
  } catch {
    logSecurityEvent({ eventType: "game_session.finalize.failed", route: "/api/game-sessions/finalize", requestId, reason: "database_operation_failed", status: 500 });
    return NextResponse.json({ message: "Official session could not be finalized." }, { status: 500, headers: CACHE });
  }
}
