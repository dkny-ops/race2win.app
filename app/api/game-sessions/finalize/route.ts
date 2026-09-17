import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { MAX_OFFICIAL_INPUTS, isAuthoritativeGameplayVersion, replayAuthoritativeRace, type LaneInputEvent } from "@/lib/game/race-to-win";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { createSecurityRequestId, logSecurityEvent } from "@/lib/observability/security-event";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (Object.keys(body).length !== 2 || typeof body.sessionId !== "string" || !UUID.test(body.sessionId) || !Array.isArray(body.inputs) || body.inputs.length > MAX_OFFICIAL_INPUTS) return null;
  const inputs: LaneInputEvent[] = [];
  let previousAtMs = -1;
  for (let index = 0; index < body.inputs.length; index += 1) {
    const input = body.inputs[index];
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const candidate = input as Record<string, unknown>;
    if (Object.keys(candidate).length !== 3 || candidate.sequence !== index || !Number.isSafeInteger(candidate.atMs) || (candidate.atMs as number) < previousAtMs || (candidate.atMs as number) < 0 || (candidate.direction !== -1 && candidate.direction !== 1)) return null;
    inputs.push({ sequence: index, atMs: candidate.atMs as number, direction: candidate.direction as -1 | 1 });
    previousAtMs = candidate.atMs as number;
  }
  return { sessionId: body.sessionId, inputs };
}

async function readBoundedJson(request: Request): Promise<unknown | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
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
    const body = parseBody(await readBoundedJson(request));
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
      .select("id, user_id, gameplay_version, seed, status, started_at, expires_at, finalized_at, input_digest, input_count, final_score, final_distance_millimeters, final_elapsed_ms, final_collision_at_ms")
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

    const digest = createHash("sha256").update(JSON.stringify(body.inputs)).digest("hex");
    if (session.status === "finalized") {
      if (session.input_digest !== digest) {
        logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/finalize", requestId, reason: "finalize_conflict", status: 409 });
        return NextResponse.json({ message: "Session already finalized." }, { status: 409, headers: CACHE });
      }
      return NextResponse.json(officialOutcome(session), { headers: CACHE });
    }
    if (session.status !== "active" || Date.now() > Date.parse(session.expires_at)) {
      if (session.status === "active") await admin.from("game_sessions").update({ status: "expired", invalidated_at: new Date().toISOString(), invalidation_reason: "expired" }).eq("id", session.id).eq("status", "active");
      logSecurityEvent({ eventType: "game_session.finalize.rejected", route: "/api/game-sessions/finalize", requestId, reason: "session_not_active", status: 409 });
      return NextResponse.json({ message: "Session unavailable." }, { status: 409, headers: CACHE });
    }
    const elapsedCapMs = Math.max(0, Math.floor(Date.now() - Date.parse(session.started_at)));
    const replay = replayAuthoritativeRace(session.gameplay_version, Number(session.seed), body.inputs, elapsedCapMs);
    if (!replay) {
      logSecurityEvent({ eventType: "game_session.anti_cheat_rejected", route: "/api/game-sessions/finalize", requestId, reason: "replay_rejected", status: 409 });
      return NextResponse.json({ message: "Run record is not yet finalizable." }, { status: 409, headers: CACHE });
    }
    const { data: finalizedSession, error: updateError } = await admin
      .from("game_sessions")
      .update({ status: "finalized", finalized_at: new Date().toISOString(), input_digest: digest, input_count: body.inputs.length, final_score: replay.score, final_distance_millimeters: replay.distanceMillimeters, final_elapsed_ms: replay.elapsedMs, final_collision_at_ms: replay.collisionAtMs })
      .eq("id", session.id)
      .eq("user_id", userId)
      .eq("status", "active")
      .select("status, input_digest, final_score, final_distance_millimeters, final_elapsed_ms, final_collision_at_ms")
      .maybeSingle();
    if (updateError) throw updateError;
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
