import { randomUUID } from "node:crypto";
import { isGameAccessHeld } from "@/lib/security/auth-401-review";
import { admin, body, json, player, sameOrigin } from "@/lib/game/jumping-race/official-server";
import { getTurnstileWidgetConfiguration } from "@/lib/security/turnstile";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) { console.warn("jumping_race_start_rejected", { stage: "origin", status: 403 }); return json({ message: "Forbidden" }, 403); }
  const b = await body(request, 1000);
  if (!b || Object.keys(b).some(k => k !== "requestId")) { console.warn("jumping_race_start_rejected", { stage: "body", status: 400 }); return json({ message: "Invalid request" }, 400); }
  const userId = await player();
  if (!userId) { console.warn("jumping_race_start_rejected", { stage: "authentication", status: 401 }); return json({ message: "Sign in to compete", practice: true }, 401); }
  if (await isGameAccessHeld(userId)) { console.warn("jumping_race_start_rejected", { stage: "security_hold", status: 403 }); return json({ message: "Account pending security review", practice: true }, 403); }
  const db = admin();
  if (!db) { console.warn("jumping_race_start_rejected", { stage: "database_configuration", status: 503 }); return json({ message: "Official play unavailable", practice: true }, 503); }
  const widget = getTurnstileWidgetConfiguration("jumping_race_session_verification");
  if (!widget) {
    console.warn("jumping_race_start_turnstile_configuration", {
      enforcementEnabled: process.env.TURNSTILE_ENFORCEMENT_ENABLED === "true",
      jumpingActionEnabled: process.env.TURNSTILE_JUMPING_RACE_ENABLED === "true",
      actionInAllowlist: (process.env.TURNSTILE_ENABLED_ACTIONS ?? "").split(",").map(value => value.trim()).includes("jumping_race_session_verification"),
      secretConfigured: Boolean(process.env.TURNSTILE_SECRET_KEY?.trim()),
      siteKeyConfigured: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
      hostnamesConfigured: Boolean(process.env.TURNSTILE_ALLOWED_HOSTNAMES?.trim()),
    });
    return json({ message: "Human verification is temporarily unavailable", practice: true }, 503);
  }
  const { data: consent, error: consentError } = await db.from("player_terms_acceptances").select("terms_version").eq("player_id", userId).maybeSingle();
  if (consentError || consent?.terms_version !== "2026-10-18") { console.warn("jumping_race_start_rejected", { stage: consentError ? "terms_lookup" : "terms_acceptance", status: 403 }); return json({ message: "Accept tournament terms before official play", practice: true }, 403); }
  const { data: control, error: controlError } = await db.rpc("jr_competition_enabled");
  if (controlError || !control) { console.warn("jumping_race_start_rejected", { stage: "competition_control", status: 503 }); return json({ message: "Official scoring not active", practice: true }, 503); }
  const requestId = typeof b.requestId === "string" && /^[a-f0-9-]{36}$/i.test(b.requestId) ? b.requestId : randomUUID();
  const { data, error } = await db.rpc("jr_start_session", { p_player_id: userId, p_request_id: requestId });
  if (error) { console.warn("jumping_race_start_rejected", { stage: "session_rpc", status: error.message.includes("exhausted") ? 429 : 503, exhausted: error.message.includes("exhausted") }); return json({ message: error.message.includes("exhausted") ? "Five official attempts used this hour" : "Unable to start official run", practice: true }, error.message.includes("exhausted") ? 429 : 503); }
  const session = Array.isArray(data) ? data[0] : data;
  if (!session?.id) { console.warn("jumping_race_start_rejected", { stage: "session_response", status: 503 }); return json({ message: "Unable to start official run", practice: true }, 503); }
  const { data: securityRows, error: securityError } = await db.rpc("jr_session_security_info", { p_session_id: session.id, p_player_id: userId });
  const security = securityRows?.[0];
  if (securityError || !security || !Number.isInteger(Number(security.course_seed)) ||
      typeof security.verification_nonce !== "string" || security.verification_status !== "pending") {
    console.warn("jumping_race_start_rejected", { stage: "session_security_info", status: 503, rpcError: Boolean(securityError), sessionFound: Boolean(security), noncePresent: typeof security?.verification_nonce === "string", verificationPending: security?.verification_status === "pending" });
    return json({ message: "Human verification is temporarily unavailable", practice: true }, 503);
  }
  console.info("jumping_race_start_accepted", { stage: "session_created" });
  return json({
    session: { ...session, courseSeed: Number(security.course_seed) },
    humanVerification: { siteKey: widget.siteKey, nonce: security.verification_nonce },
    requestId,
  });
}
