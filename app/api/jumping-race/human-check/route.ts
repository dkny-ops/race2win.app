import { body, admin, json, player, sameOrigin, uuid } from "@/lib/game/jumping-race/official-server";
import { getTurnstileWidgetConfiguration, verifyTurnstileToken } from "@/lib/security/turnstile";

export const runtime = "nodejs";

/** Server-only session gate. The browser supplies a token, never a decision. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ message: "Forbidden" }, 403);
  const record = await body(request, 4_096);
  if (!record || Object.keys(record).length !== 3 || !uuid(record.sessionId) || !uuid(record.nonce) ||
      typeof record.token !== "string" || record.token.length === 0 || record.token.length > 2_048) {
    return json({ message: "Invalid verification" }, 400);
  }
  const userId = await player();
  const db = admin();
  if (!userId || !db) return json({ message: "Verification unavailable" }, 401);
  if (!getTurnstileWidgetConfiguration("jumping_race_session_verification")) return json({ message: "Verification unavailable" }, 503);
  const { data: rows, error } = await db.rpc("jr_session_security_info", { p_session_id: record.sessionId, p_player_id: userId });
  const session = rows?.[0];
  if (error || !session || session.status !== "active" || session.verification_status !== "pending" || session.verification_nonce !== record.nonce) {
    return json({ message: "Verification unavailable" }, 409);
  }
  const verification = await verifyTurnstileToken(record.token, "jumping_race_session_verification", { expectedCdata: record.nonce });
  if (verification.status !== "verified") {
    console.warn("jumping_race_turnstile", { status: verification.status, reason: verification.reason });
    return json({ message: "Verification unavailable" }, verification.status === "unavailable" ? 503 : 403);
  }
  const { data, error: verifyError } = await db.rpc("jr_verify_session_human", {
    p_session_id: record.sessionId,
    p_player_id: userId,
    p_nonce: record.nonce,
  });
  if (verifyError || data !== true) return json({ message: "Verification unavailable" }, 409);
  return json({ verified: true });
}
