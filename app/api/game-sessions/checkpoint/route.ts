import { NextResponse } from "next/server";
import {
  MAX_OFFICIAL_INPUTS,
  isAuthoritativeGameplayVersion,
  type LaneInputEvent,
  replayAuthoritativeProgress,
} from "@/lib/game/race-to-win";
import { SCORE_CHECKPOINT_INTERVAL, digestOfficialInputs, proofMatchesInputs } from "@/lib/game/race-to-win/checkpoints";
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
      .select("id, user_id, gameplay_version, seed, status, started_at, expires_at")
      .eq("id", body.sessionId)
      .eq("user_id", playerId)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) {
      logSecurityEvent({ eventType: "game_session.checkpoint.rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "session_not_found", status: 404 });
      return NextResponse.json({ message: "Session unavailable." }, { status: 404, headers: CACHE });
    }
    if (session.status !== "active" || Date.now() > Date.parse(session.expires_at) || !isAuthoritativeGameplayVersion(session.gameplay_version)) {
      logSecurityEvent({ eventType: "game_session.checkpoint.rejected", route: "/api/game-sessions/checkpoint", requestId, reason: session.status !== "active" ? "session_not_active" : "gameplay_version_rejected", status: 409 });
      return NextResponse.json({ message: "Session unavailable." }, { status: 409, headers: CACHE });
    }

    const elapsedCapMs = Math.max(0, Math.floor(Date.now() - Date.parse(session.started_at)));
    const progress = replayAuthoritativeProgress(session.gameplay_version, Number(session.seed), body.inputs, elapsedCapMs);
    const milestoneScore = body.checkpointIndex * SCORE_CHECKPOINT_INTERVAL;
    if (!progress || progress.score < milestoneScore) {
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "replay_rejected", status: 409 });
      return NextResponse.json({ message: "Checkpoint is not yet available." }, { status: 409, headers: CACHE });
    }

    const checkpointTable = admin.schema("private").from("game_session_checkpoints");
    const { data: existing, error: existingError } = await checkpointTable
      .select("checkpoint_index, milestone_score, proof_input_digest, proof_input_count")
      .eq("game_session_id", session.id)
      .order("checkpoint_index", { ascending: true });
    if (existingError) throw existingError;
    const proofs = existing ?? [];
    if (proofs.some((proof) => !proofMatchesInputs(proof, body.inputs))) {
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "finalize_conflict", status: 409 });
      return NextResponse.json({ message: "Checkpoint conflicts with prior evidence." }, { status: 409, headers: CACHE });
    }
    const expectedNext = proofs.length + 1;
    if (body.checkpointIndex < expectedNext) {
      // An exact retry returns canonical success. A changed proof was rejected
      // above; this produces no duplicate state.
      return NextResponse.json({ checkpointIndex: body.checkpointIndex, milestoneScore, accepted: true }, { headers: CACHE });
    }

    // A missing network request does not penalize a legitimate player: when
    // this full deterministic replay proves the higher milestone, the server
    // atomically persists every missing 5,000-point checkpoint in order.
    const digest = digestOfficialInputs(body.inputs);
    const missing = Array.from({ length: body.checkpointIndex - expectedNext + 1 }, (_, offset) => {
      const checkpointIndex = expectedNext + offset;
      return {
        game_session_id: session.id,
        player_id: playerId,
        gameplay_version: session.gameplay_version,
        checkpoint_index: checkpointIndex,
        milestone_score: checkpointIndex * SCORE_CHECKPOINT_INTERVAL,
        proof_input_digest: digest,
        proof_input_count: body.inputs.length,
      };
    });
    const { error: insertError } = await checkpointTable.insert(missing);
    if (insertError) {
      // The unique key is the concurrency arbiter. Re-read canonical rows;
      // only the same evidence is accepted as an idempotent concurrent retry.
      const { data: canonical, error: canonicalError } = await checkpointTable
        .select("checkpoint_index, milestone_score, proof_input_digest, proof_input_count")
        .eq("game_session_id", session.id)
        .order("checkpoint_index", { ascending: true });
      if (canonicalError) throw canonicalError;
      const checkpoint = (canonical ?? []).find((row) => row.checkpoint_index === body.checkpointIndex);
      if (checkpoint && proofMatchesInputs(checkpoint, body.inputs)) {
        return NextResponse.json({ checkpointIndex: body.checkpointIndex, milestoneScore, accepted: true }, { headers: CACHE });
      }
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/checkpoint", requestId, reason: "finalize_conflict", status: 409 });
      return NextResponse.json({ message: "Checkpoint conflicts with prior evidence." }, { status: 409, headers: CACHE });
    }
    return NextResponse.json({ checkpointIndex: body.checkpointIndex, milestoneScore, accepted: true }, { headers: CACHE });
  } catch {
    logSecurityEvent({ eventType: "game_session.checkpoint.failed", route: "/api/game-sessions/checkpoint", requestId, reason: "database_operation_failed", status: 500 });
    return NextResponse.json({ message: "Checkpoint could not be recorded." }, { status: 500, headers: CACHE });
  }
}
