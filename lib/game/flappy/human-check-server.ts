import "server-only";
import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/competition/request-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { getTurnstileWidgetConfiguration, verifyTurnstileToken } from "@/lib/security/turnstile";
import { FLAPPY_COMPETITION_ENABLED } from "./activation";
import { flappyPlayerAccess } from "./server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };
const defaults = {
  user: async () => (await getVerifiedUserContext())?.userId ?? null,
  access: flappyPlayerAccess, admin: createAdminClient, enabled: FLAPPY_COMPETITION_ENABLED,
  configuration: getTurnstileWidgetConfiguration, verify: verifyTurnstileToken,
};
export async function handleFlappyHumanCheck(request: Request, deps = defaults) {
  const reject = (status: number, code: string) => NextResponse.json({ code, message: "Verification unavailable." }, { status, headers });
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reject(403, "origin");
    const player = await deps.user();
    if (!player) return reject(401, "unauthenticated");
    if (!deps.enabled) return reject(403, "FLAPPY_OFFICIAL_DISABLED");
    const access = await deps.access(player);
    if (access !== "allowed") return reject(403, access);
    if (!deps.configuration("midrun_human_check")) return reject(503, "verification_unavailable");
    const admin = deps.admin();
    const quota = await admin.rpc("flappy_consume_quota", { p_player: player, p_action: "checkpoint" });
    if (quota.error) return reject(503, "verification_unavailable");
    if (quota.data !== true) return reject(429, "rate_limited");
    const body = await readBoundedJson(request, 4096);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reject(400, "invalid_body");
    const b = body as Record<string, unknown>;
    const submitting = Object.hasOwn(b, "token");
    if (Object.keys(b).length !== (submitting ? 3 : 1) || typeof b.sessionId !== "string" || !UUID.test(b.sessionId) ||
        (submitting && (typeof b.nonce !== "string" || !UUID.test(b.nonce) || typeof b.token !== "string" || !b.token.length || b.token.length > 2048))) return reject(400, "invalid_body");
    const args = { p_player: player, p_session: b.sessionId };
    const state = await admin.rpc("flappy_turnstile_status", args);
    if (state.error || !state.data) return reject(409, "session_unavailable");
    if (!submitting) return NextResponse.json(state.data, { headers });
    if (!state.data.required || !state.data.due || state.data.nonce !== b.nonce) return reject(409, "challenge_unavailable");
    const result = await deps.verify(b.token, "midrun_human_check", { expectedCdata: b.nonce as string });
    if (result.status !== "verified") {
      console.warn("flappy_invisible_verification", { status: result.status, reason: result.reason });
      return reject(result.status === "unavailable" ? 503 : 403, "verification_unavailable");
    }
    const verified = await admin.rpc("flappy_turnstile_verify", { ...args, p_nonce: b.nonce });
    if (verified.error || !verified.data) return reject(409, "challenge_unavailable");
    return NextResponse.json(verified.data, { headers });
  } catch { return reject(503, "verification_unavailable"); }
}
