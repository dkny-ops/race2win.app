import { randomUUID } from "node:crypto";
import { isGameAccessHeld } from "@/lib/security/auth-401-review";
import { admin, body, json, player, sameOrigin } from "@/lib/game/jumping-race/official-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ message: "Forbidden" }, 403);
  const b = await body(request, 1000);
  if (!b || Object.keys(b).some(k => k !== "requestId")) return json({ message: "Invalid request" }, 400);
  const userId = await player();
  if (!userId) return json({ message: "Sign in to compete", practice: true }, 401);
  if (await isGameAccessHeld(userId)) return json({ message: "Account pending security review", practice: true }, 403);
  const db = admin();
  if (!db) return json({ message: "Official play unavailable", practice: true }, 503);
  const { data: consent, error: consentError } = await db.from("player_terms_acceptances").select("terms_version").eq("player_id", userId).maybeSingle();
  if (consentError || consent?.terms_version !== "2026-10-18") return json({ message: "Accept tournament terms before official play", practice: true }, 403);
  const { data: control, error: controlError } = await db.rpc("jr_competition_enabled");
  if (controlError || !control) return json({ message: "Official scoring not active", practice: true }, 503);
  const requestId = typeof b.requestId === "string" && /^[a-f0-9-]{36}$/i.test(b.requestId) ? b.requestId : randomUUID();
  const { data, error } = await db.rpc("jr_start_session", { p_player_id: userId, p_request_id: requestId });
  if (error) return json({ message: error.message.includes("exhausted") ? "Five official attempts used this hour" : "Unable to start official run", practice: true }, error.message.includes("exhausted") ? 429 : 503);
  return json({ session: Array.isArray(data) ? data[0] : data, requestId });
}
