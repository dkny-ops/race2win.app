import { admin, body, json, player, sameOrigin, uuid } from "@/lib/game/jumping-race/official-server";
import { getTurnstileWidgetConfiguration } from "@/lib/security/turnstile";

export const runtime = "nodejs";

/** Issues the one-time, server-stored binding used after Game Over. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ message: "Forbidden" }, 403);
  const record = await body(request, 1_000);
  if (!record || Object.keys(record).length !== 1 || !uuid(record.sessionId)) return json({ message: "Invalid verification request" }, 400);
  const userId = await player();
  const db = admin();
  if (!userId || !db) return json({ message: "Verification unavailable" }, 401);
  const widget = getTurnstileWidgetConfiguration("jumping_race_finalize");
  if (!widget) return json({ message: "Verification unavailable" }, 503);
  const { data, error } = await db.rpc("jr_prepare_finalize_human", {
    p_session_id: record.sessionId,
    p_player_id: userId,
  });
  const challenge = Array.isArray(data) ? data[0] : data;
  if (error || !challenge) {
    return json({ message: "Verification unavailable" }, 409);
  }
  // The browser may lose the response after Siteverify succeeded. Preserve
  // idempotent finalization without minting a second provider token.
  if (challenge.verification_status === "verified") return json({ verified: true });
  if (typeof challenge.verification_nonce !== "string" || challenge.verification_status !== "pending") {
    return json({ message: "Verification unavailable" }, 409);
  }
  return json({ humanVerification: { siteKey: widget.siteKey, nonce: challenge.verification_nonce } });
}
