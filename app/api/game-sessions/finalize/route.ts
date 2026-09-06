import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { MAX_OFFICIAL_INPUTS, replayAuthoritativeRace, type LaneInputEvent } from "@/lib/game/race-to-win";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
const CACHE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FinalizeBody = { sessionId: string; inputs: LaneInputEvent[] };

async function verifiedUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
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

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) return NextResponse.json({ message: "Invalid run record." }, { status: 400, headers: CACHE });
    const body = parseBody(await request.json());
    if (!body) return NextResponse.json({ message: "Invalid run record." }, { status: 400, headers: CACHE });
    const userId = await verifiedUserId();
    if (!userId) return NextResponse.json({ message: "Sign in to finalize an official session." }, { status: 401, headers: CACHE });
    if (!isAdminConfigured()) return NextResponse.json({ message: "Official sessions are unavailable." }, { status: 503, headers: CACHE });

    const admin = createAdminClient();
    const { data: session, error } = await admin
      .from("game_sessions")
      .select("id, user_id, gameplay_version, seed, status, started_at, expires_at, finalized_at, input_digest, input_count, final_score, final_distance_millimeters, final_elapsed_ms, final_collision_at_ms")
      .eq("id", body.sessionId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!session) return NextResponse.json({ message: "Session unavailable." }, { status: 404, headers: CACHE });

    const digest = createHash("sha256").update(JSON.stringify(body.inputs)).digest("hex");
    if (session.status === "finalized") {
      if (session.input_digest !== digest) return NextResponse.json({ message: "Session already finalized." }, { status: 409, headers: CACHE });
      return NextResponse.json({ score: session.final_score, distanceMillimeters: session.final_distance_millimeters, elapsedMs: session.final_elapsed_ms, collisionAtMs: session.final_collision_at_ms }, { headers: CACHE });
    }
    if (session.status !== "active" || Date.now() > Date.parse(session.expires_at)) {
      if (session.status === "active") await admin.from("game_sessions").update({ status: "expired", invalidated_at: new Date().toISOString(), invalidation_reason: "expired" }).eq("id", session.id).eq("status", "active");
      return NextResponse.json({ message: "Session unavailable." }, { status: 409, headers: CACHE });
    }
    const elapsedCapMs = Math.max(0, Math.floor(Date.now() - Date.parse(session.started_at)));
    const replay = replayAuthoritativeRace(Number(session.seed), body.inputs, elapsedCapMs);
    if (!replay) return NextResponse.json({ message: "Run record is not yet finalizable." }, { status: 409, headers: CACHE });
    const { error: updateError } = await admin.from("game_sessions").update({ status: "finalized", finalized_at: new Date().toISOString(), input_digest: digest, input_count: body.inputs.length, final_score: replay.score, final_distance_millimeters: replay.distanceMillimeters, final_elapsed_ms: replay.elapsedMs, final_collision_at_ms: replay.collisionAtMs }).eq("id", session.id).eq("user_id", userId).eq("status", "active");
    if (updateError) throw updateError;
    return NextResponse.json(replay, { headers: CACHE });
  } catch {
    return NextResponse.json({ message: "Official session could not be finalized." }, { status: 400, headers: CACHE });
  }
}
