import { recordCompetitionAccess, competitionAccessMessage } from "@/lib/security/competition-access";
import "server-only";
import { getTurnstileWidgetConfiguration, verifyTurnstileToken } from "@/lib/security/turnstile";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/competition/request-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { isGameAccessHeld } from "@/lib/security/auth-401-review";
import { FLAPPY_COMPETITION_ENABLED } from "./activation";
import { FLAPPY_VERSION, MAX_TICKS, parseFlaps, replayFlappy } from "./engine";
type Action = "start" | "checkpoint" | "finalize";
type Deps = { access: (player: string) => Promise<"allowed" | "review_required" | "terms_required">; enabled: boolean; user: () => Promise<string | null>; admin: typeof createAdminClient; now: () => number; verify?: typeof verifyTurnstileToken; configuration?: typeof getTurnstileWidgetConfiguration };
export async function flappyPlayerAccess(player: string): Promise<"allowed" | "review_required" | "terms_required"> {
  if (await isGameAccessHeld(player)) return "review_required";
  const { data, error } = await createAdminClient().from("player_terms_acceptances").select("terms_version").eq("player_id", player).maybeSingle();
  if (error) throw new Error("Access unavailable");
  return data?.terms_version === "2026-10-18" ? "allowed" : "terms_required";
}
const defaults: Deps = { access: flappyPlayerAccess, enabled: FLAPPY_COMPETITION_ENABLED, user: async () => (await getVerifiedUserContext())?.userId ?? null, admin: createAdminClient, now: Date.now, verify: verifyTurnstileToken, configuration: getTurnstileWidgetConfiguration };
function seedFromServer(): number {
  // Every official session receives a cryptographically random, persisted
  // seed. The client can render it, but it cannot choose or replace it.
  return randomInt(0x1_0000_0000);
}
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
    if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reject(action, 403, "origin");
    const player = await deps.user();
    if (!player) return reject(action, 401, "unauthenticated");
    if (!deps.enabled) return reject(action, 403, "FLAPPY_OFFICIAL_DISABLED");
    const access = await deps.access(player);
    if (access !== "allowed") return reject(action, 403, access);
    let verifiedPreflightNonce: string | null = null;
    if (action === "start") {
      if (!deps.configuration?.("midrun_human_check")) return reject(action, 503, "verification_unavailable");
      const preflight = await readBoundedJson(request, 4096);
      if (!preflight || typeof preflight !== "object" || Array.isArray(preflight) ||
          Object.keys(preflight).length !== 2 || typeof (preflight as Record<string, unknown>).token !== "string" ||
          typeof (preflight as Record<string, unknown>).nonce !== "string" || !UUID.test((preflight as Record<string, unknown>).nonce as string))
        return reject(action, 403, "verification_unavailable");
      const verified = await deps.verify?.((preflight as Record<string, unknown>).token, "midrun_human_check", {
        expectedCdata: (preflight as Record<string, unknown>).nonce as string,
      });
      if (verified?.status !== "verified") return reject(action, 403, "verification_unavailable");
      verifiedPreflightNonce = (preflight as Record<string, unknown>).nonce as string;
    }
    const admin = deps.admin();
    const quota = await admin.rpc("flappy_consume_quota", { p_player: player, p_action: action });
    if (quota.error) return reject(action, 503, "quota_unavailable");
    if (quota.data !== true) return reject(action, 429, "rate_limited");
    const body = action === "start" ? { token: "verified", nonce: verifiedPreflightNonce } : await readBoundedJson(request, 48 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reject(action, 400, "invalid_body");
    const b = body as Record<string, unknown>;
    if (action === "start") {
      if (Object.keys(b).length !== 2 || typeof b.token !== "string" || typeof b.nonce !== "string" || !UUID.test(b.nonce)) return reject(action, 400, "invalid_body");
      const identity = await recordCompetitionAccess(player, "flappy-race", request);
      if (identity !== "allowed") return NextResponse.json({ message: competitionAccessMessage(identity), code: identity }, { status: identity === "unavailable" ? 503 : 403, headers });
      const { data, error } = await admin.rpc("flappy_start", { p_player: player, p_seed: seedFromServer(), p_version: FLAPPY_VERSION, p_preflight: b.nonce });
      // Match only known database errors; never expose SQL/error details.
      if (error?.code === "P0001" && error.message === "Hourly limit") return reject(action, 429, "attempts_exhausted");
      if (error?.code === "P0001" && error.message === "Concurrent session") return reject(action, 409, "session_active");
      if (error || !data) return reject(action, error?.code === "P0001" ? 409 : 503, "start_rejected");
      return NextResponse.json({ ...data, serverNow: new Date(deps.now()).toISOString() }, { headers });
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

/** Creates a short-lived, single-use server nonce before the widget runs.
 * The widget is never mounted during flight; Siteverify binds its cdata to this
 * player-owned nonce, and the START RPC consumes it atomically into the session.
 */
export async function handleFlappyPreflight(request: Request, deps: Deps = defaults) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reject("start", 403, "origin");
    const player = await deps.user();
    if (!player) return reject("start", 401, "unauthenticated");
    if (!deps.enabled) return reject("start", 403, "FLAPPY_OFFICIAL_DISABLED");
    const access = await deps.access(player);
    if (access !== "allowed") return reject("start", 403, access);
    const configuration = deps.configuration?.("midrun_human_check");
    if (!configuration) return reject("start", 503, "verification_unavailable");
    const admin = deps.admin();
    const quota = await admin.rpc("flappy_consume_quota", { p_player: player, p_action: "checkpoint" });
    if (quota.error || quota.data !== true) return reject("start", quota.data === false ? 429 : 503, quota.data === false ? "rate_limited" : "quota_unavailable");
    const { data, error } = await admin.rpc("flappy_create_preflight", { p_player: player });
    if (error || !data || typeof data.nonce !== "string" || !UUID.test(data.nonce) || typeof data.expiresAt !== "string") return reject("start", 503, "verification_unavailable");
    return NextResponse.json({ ...data, siteKey: configuration.siteKey }, { headers });
  } catch { return reject("start", 503, "verification_unavailable"); }
}

/** Runs after collision, never during the Canvas animation loop. */
export async function handleFlappyFinalProof(request: Request, deps: Deps = defaults) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reject("finalize", 403, "origin");
    const player = await deps.user();
    if (!player) return reject("finalize", 401, "unauthenticated");
    if (!deps.enabled) return reject("finalize", 403, "FLAPPY_OFFICIAL_DISABLED");
    if (await deps.access(player) !== "allowed") return reject("finalize", 403, "review_required");
    const configuration = deps.configuration?.("midrun_human_check");
    if (!configuration) return reject("finalize", 503, "verification_unavailable");
    const body = await readBoundedJson(request, 4096);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reject("finalize", 400, "invalid_body");
    const value = body as Record<string, unknown>;
    const submitting = Object.hasOwn(value, "token");
    if (Object.keys(value).length !== (submitting ? 3 : 1) || typeof value.sessionId !== "string" || !UUID.test(value.sessionId) ||
      (submitting && (typeof value.nonce !== "string" || !UUID.test(value.nonce) || typeof value.token !== "string" || value.token.length < 1 || value.token.length > 2048))) return reject("finalize", 400, "invalid_body");
    const admin = deps.admin();
    if (!submitting) {
      const { data, error } = await admin.rpc("flappy_create_final_check", { p_player: player, p_session: value.sessionId });
      if (error || !data || typeof data.nonce !== "string" || !UUID.test(data.nonce) || typeof data.expiresAt !== "string") return reject("finalize", 409, "challenge_unavailable");
      return NextResponse.json({ ...data, siteKey: configuration.siteKey }, { headers });
    }
    const verified = await deps.verify?.(value.token, "midrun_human_check", { expectedCdata: value.nonce as string });
    if (verified?.status !== "verified") return reject("finalize", verified?.status === "unavailable" ? 503 : 403, "verification_unavailable");
    const { data, error } = await admin.rpc("flappy_verify_final_check", { p_player: player, p_session: value.sessionId, p_nonce: value.nonce });
    if (error || !data) return reject("finalize", 409, "challenge_unavailable");
    return NextResponse.json(data, { headers });
  } catch { return reject("finalize", 503, "verification_unavailable"); }
}
