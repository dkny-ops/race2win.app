import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/competition/request-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { isGameAccessHeld } from "@/lib/security/auth-401-review";
import { FLAPPY_COMPETITION_ENABLED } from "./activation";
import { FLAPPY_VERSION, MAX_TICKS, parseFlaps, replayFlappy } from "./engine";
type Action = "start" | "checkpoint" | "finalize";
type Deps = { access: (player: string) => Promise<"allowed" | "review_required" | "terms_required">; enabled: boolean; user: () => Promise<string | null>; admin: typeof createAdminClient; now: () => number };
export async function flappyPlayerAccess(player: string): Promise<"allowed" | "review_required" | "terms_required"> {
  if (await isGameAccessHeld(player)) return "review_required";
  const { data, error } = await createAdminClient().from("player_terms_acceptances").select("terms_version").eq("player_id", player).maybeSingle();
  if (error) throw new Error("Access unavailable");
  return data?.terms_version === "2026-10-18" ? "allowed" : "terms_required";
}
const defaults: Deps = { access: flappyPlayerAccess, enabled: FLAPPY_COMPETITION_ENABLED, user: async () => (await getVerifiedUserContext())?.userId ?? null, admin: createAdminClient, now: Date.now };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function flapDigest(inputs: number[]): string { return createHash("sha256").update(JSON.stringify(inputs)).digest("hex"); }
const headers = { "Cache-Control": "private, no-store" };
function reject(action: Action, status: number, reason: string) {
  // Bounded server-selected metadata only; never log inputs, auth, IDs or SQL errors.
  console.warn(JSON.stringify({ event: "flappy." + action + ".rejected", reason, status, requestId: randomUUID() }));
  return NextResponse.json({ message: "Official FlappyRace request unavailable.", code: reason }, { status, headers });
}
// Dependency injection exists solely for isolated integration tests. Route
// exports never accept client-controlled dependencies or activation values.
export async function handleFlappy(action: Action, request: Request, deps: Deps = defaults) {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return reject(action, 403, "origin");
    const player = await deps.user();
    if (!player) return reject(action, 401, "unauthenticated");
    if (!deps.enabled) return reject(action, 403, "FLAPPY_OFFICIAL_DISABLED");
    const access = await deps.access(player);
    if (access !== "allowed") return reject(action, 403, access);
    const admin = deps.admin();
    const quota = await admin.rpc("flappy_consume_quota", { p_player: player, p_action: action });
    if (quota.error) return reject(action, 503, "quota_unavailable");
    if (quota.data !== true) return reject(action, 429, "rate_limited");
    const body = await readBoundedJson(request, 48 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reject(action, 400, "invalid_body");
    const b = body as Record<string, unknown>;
    if (action === "start") {
      if (Object.keys(b).length) return reject(action, 400, "invalid_body");
      const { data, error } = await admin.rpc("flappy_start", { p_player: player, p_seed: randomInt(0x100000000), p_version: FLAPPY_VERSION });
      if (error || !data) return reject(action, error?.code === "P0001" ? 409 : 503, "start_rejected");
      return NextResponse.json(data, { headers });
    }
    if (Object.keys(b).length !== 3 || typeof b.sessionId !== "string" || !UUID.test(b.sessionId) ||
        typeof b.throughTick !== "number") return reject(action, 400, "invalid_body");
    const inputs = parseFlaps(b.inputs, b.throughTick);
    if (!inputs) return reject(action, 400, "invalid_inputs");
    const { data: session, error: readError } = await admin.rpc("flappy_read_session", { p_player: player, p_session: b.sessionId });
    if (readError || !session) return reject(action, 404, "session_unavailable");
    if (session.version !== FLAPPY_VERSION) return reject(action, 409, "version");
    const digest = flapDigest(inputs);
    if (session.status === "finalized") {
      if (action !== "finalize" || session.digest !== digest || session.tick !== b.throughTick) return reject(action, 409, "finalize_conflict");
      return NextResponse.json(session.outcome, { headers });
    }
    const now = deps.now();
    const started = Date.parse(session.startsAt), expires = Date.parse(session.expiresAt), lease = Date.parse(session.leaseUntil);
    const elapsed = now - started;
    if (session.status !== "active" || !Number.isFinite(started + expires + lease) || now > expires || now > lease || elapsed < 0) return reject(action, 409, "expired");
    if (b.throughTick > Math.min(MAX_TICKS, Math.floor(elapsed * 60 / 1000) + 2)) return reject(action, 409, "future_input");
    const previous = session.inputs as number[];
    if (!Array.isArray(previous) || inputs.length < previous.length ||
        previous.some((value, index) => value !== inputs[index]) ||
        inputs.slice(previous.length).some(tick => tick < session.tick) ||
        b.throughTick < session.tick) return reject(action, 409, "checkpoint_conflict");
    const replay = replayFlappy(Number(session.seed), inputs, b.throughTick);
    if (!replay || (action === "checkpoint" && replay.dead) || (action === "finalize" && !replay.dead) ||
        replay.tick !== b.throughTick) return reject(action, 409, "replay_rejected");
    const { data, error } = await admin.rpc("flappy_record_evidence", {
      p_player: player, p_session: b.sessionId, p_action: action,
      p_expected_tick: session.tick, p_inputs: inputs, p_tick: replay.tick,
      p_digest: digest, p_score: replay.score,
    });
    if (error || !data) return reject(action, 409, "evidence_conflict");
    return NextResponse.json(data, { headers });
  } catch { return reject(action, 503, "service_unavailable"); }
}
