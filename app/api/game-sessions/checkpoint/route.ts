import { NextResponse } from "next/server";
import {
  MAX_OFFICIAL_INPUTS,
  isAuthoritativeGameplayVersion,
  type LaneInputEvent,
  replayAuthoritativeProgress,
} from "@/lib/game/race-to-win";
import { digestOfficialInputs, isCheckpointInterval, proofMatchesInputs, type StoredCheckpointProof } from "@/lib/game/race-to-win/checkpoints";
import { OFFICIAL_SESSION_UUID, parseOfficialInputs, readOfficialSessionJson } from "@/lib/game/race-to-win/official-inputs";
import { consumeCompetitionActionRateLimit, getVerifiedPlayerId } from "@/lib/competition/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" } as const;

type CheckpointBody = Readonly<{
  sessionId: string;
  checkpointIndex: number;
  inputs: LaneInputEvent[];
}>;

function parseBody(value: unknown): CheckpointBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 3 ||
    typeof body.sessionId !== "string" ||
    !OFFICIAL_SESSION_UUID.test(body.sessionId) ||
    !Number.isSafeInteger(body.checkpointIndex) ||
    (body.checkpointIndex as number) < 1 ||
    (body.checkpointIndex as number) > 10_000
  ) return null;
  const inputs = parseOfficialInputs(body.inputs, MAX_OFFICIAL_INPUTS);
  return inputs ? { sessionId: body.sessionId, checkpointIndex: body.checkpointIndex as number, inputs } : null;
}

export async function POST(request: Request) {
  const requestId = createSecurityRequestId();
  try {
    const body = parseBody(await readOfficialSessionJson(request));
    if (!body) {
      logSecurityEvent({ eventType: "game_session.checkpoint.rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "invalid_request", status: 400 });
      return NextResponse.json({ message: "Invalid checkpoint." }, { status: 400, headers: CACHE });
    }
    const playerId = await getVerifiedPlayerId();
    if (!playerId) {
      logSecurityEvent({ eventType: "game_session.checkpoint.rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "unauthenticated", status: 401 });
      return NextResponse.json({ message: "Sign in to continue an official session." }, { status: 401, headers: CACHE });
    }
    if (!isAdminConfigured()) {
      logSecurityEvent({ eventType: "game_session.checkpoint.failed", route: "/api/game-sessions/checkpoint", requestId, reason: "missing_configuration", status: 503 });
      return NextResponse.json({ message: "Official sessions are unavailable." }, { status: 503, headers: CACHE });
    }
    const allowed = await consumeCompetitionActionRateLimit(playerId, "game_checkpoint");
    if (allowed !== true) {
      logSecurityEvent({ eventType: "game_session.checkpoint.rejected", route: "/api/game-sessions/checkpoint", requestId, reason: allowed === false ? "rate_limited" : "database_operation_failed", status: allowed === false ? 429 : 503 });
      return NextResponse.json({ message: allowed === false ? "Try again shortly." : "Official sessions are unavailable." }, { status: allowed === false ? 429 : 503, headers: CACHE });
    }

    const admin = createAdminClient();
    const { data: session, error: sessionError } = await admin
      .from("game_sessions")
      .select("id, user_id, gameplay_version, seed, status, started_at, expires_at, checkpoint_interval_score, activity_lease_expires_at")
      .eq("id", body.sessionId)
      .eq("user_id", playerId)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) {
      logSecurityEvent({ eventType: "game_session.checkpoint.rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "session_not_found", status: 404 });
      return NextResponse.json({ message: "Session unavailable." }, { status: 404, headers: CACHE });
    }
    if (session.status !== "active" || !isAuthoritativeGameplayVersion(session.gameplay_version) || !isCheckpointInterval(session.checkpoint_interval_score)) {
      logSecurityEvent({ eventType: "game_session.checkpoint.rejected", route: "/api/game-sessions/checkpoint", requestId, reason: session.status !== "active" ? "session_not_active" : "gameplay_version_rejected", status: 409 });
      return NextResponse.json({ message: "Session unavailable." }, { status: 409, headers: CACHE });
    }

    const elapsedCapMs = Math.max(0, Math.floor(Date.now() - Date.parse(session.started_at)));
    const progress = replayAuthoritativeProgress(session.gameplay_version, Number(session.seed), body.inputs, elapsedCapMs);
    const checkpointInterval = Number(session.checkpoint_interval_score);
    const milestoneScore = body.checkpointIndex * checkpointInterval;
    if (!progress || progress.score < milestoneScore) {
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "replay_rejected", status: 409 });
      return NextResponse.json({ message: "Checkpoint is not yet available." }, { status: 409, headers: CACHE });
    }

    const { data: existing, error: existingError } = await admin.rpc("rtw_read_game_session_checkpoint_proofs", {
      p_session_id: session.id,
      p_player_id: playerId,
    });
    if (existingError) throw existingError;
    const proofs = (existing ?? []) as StoredCheckpointProof[];
    if (proofs.some((proof) => !proofMatchesInputs(proof, body.inputs, checkpointInterval))) {
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "finalize_conflict", status: 409 });
      return NextResponse.json({ message: "Checkpoint conflicts with prior evidence." }, { status: 409, headers: CACHE });
    }
    // A missing network request does not penalize a legitimate player: when
    // this full deterministic replay proves the higher milestone, the server
    // atomically persists every missing checkpoint in order and renews the
    // activity lease exactly once. The database row lock is the concurrency
    // arbiter, so an exact concurrent retry cannot extend it again.
    const digest = digestOfficialInputs(body.inputs);
    const { data: checkpointRows, error: checkpointError } = await admin.rpc("rtw_record_game_session_checkpoint_with_lease", {
      p_session_id: session.id,
      p_player_id: playerId,
      p_checkpoint_index: body.checkpointIndex,
      p_proof_input_digest: digest,
      p_proof_input_count: body.inputs.length,
    });
    if (checkpointError) {
      if (checkpointError.code === "23514" || checkpointError.code === "P0002") {
        logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "finalize_conflict", status: 409 });
        return NextResponse.json({ message: "Checkpoint conflicts with prior evidence." }, { status: 409, headers: CACHE });
      }
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "finalize_conflict", status: 409 });
      return NextResponse.json({ message: "Checkpoint conflicts with prior evidence." }, { status: 409, headers: CACHE });
    }
    const checkpoint = Array.isArray(checkpointRows) ? checkpointRows[0] : null;
    if (!checkpoint || checkpoint.accepted !== true) throw new Error("Unexpected checkpoint response");
    return NextResponse.json({ checkpointIndex: body.checkpointIndex, milestoneScore, accepted: true }, { headers: CACHE });
  } catch {
    logSecurityEvent({ eventType: "game_session.checkpoint.failed", route: "/api/game-sessions/checkpoint", requestId, reason: "database_operation_failed", status: 500 });
    return NextResponse.json({ message: "Checkpoint could not be recorded." }, { status: 500, headers: CACHE });
  }
}
