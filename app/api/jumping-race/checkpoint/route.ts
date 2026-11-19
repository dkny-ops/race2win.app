import { admin, body, digest, json, player, sameOrigin, uuid } from "@/lib/game/jumping-race/official-server";
import { digestJumpingRaceActions, parseJumpingRaceActions } from "@/lib/game/jumping-race/authoritative-replay";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ message: "Forbidden" }, 403);
  const b = await body(request);
  if (!b || !uuid(b.sessionId) || !Number.isSafeInteger(b.index) || !Array.isArray(b.actions) || !digest(b.digest)) return json({ message: "Invalid checkpoint" }, 400);
  const userId = await player(); if (!userId) return json({ message: "Sign in required" }, 401);
  const db = admin(); if (!db) return json({ message: "Unavailable" }, 503);
  const actions = parseJumpingRaceActions(b.actions);
  if (!actions || actions.length > 1000 || digestJumpingRaceActions(actions) !== b.digest) return json({ message: "Invalid actions" }, 400);
  const { data: sessionRows, error: sessionError } = await db.rpc("jr_session_security_info", { p_session_id: b.sessionId, p_player_id: userId });
  const session = sessionRows?.[0];
  if (sessionError || !session || session.status !== "active") return json({ message: "Session unavailable" }, 409);
  const elapsed = Date.now() - Date.parse(session.started_at);
  if (elapsed < 0 || elapsed > 12 * 60_000 || actions.some(a => a.step > Math.floor((elapsed + 1000) * 120 / 1000))) return json({ message: "Future actions rejected" }, 409);
  const { error } = await db.rpc("jr_store_checkpoint", { p_session_id: b.sessionId, p_player_id: userId, p_checkpoint_index: b.index, p_actions: actions, p_action_digest: b.digest });
  if (error) return json({ message: "Checkpoint rejected" }, 409);
  return json({ accepted: true });
}
