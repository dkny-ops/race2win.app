import { admin, body, json, player, sameOrigin, uuid } from "@/lib/game/jumping-race/official-server";
import { digestJumpingRaceActions, parseJumpingRaceActions, replayJumpingRace } from "@/lib/game/jumping-race/authoritative-replay";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ message: "Forbidden" }, 403);
  const b = await body(request, 1500);
  if (!b || !uuid(b.sessionId)) return json({ message: "Invalid finalization" }, 400);
  const userId = await player(); if (!userId) return json({ message: "Sign in required" }, 401);
  const db = admin(); if (!db) return json({ message: "Unavailable" }, 503);
  const { data: session, error: se } = await db.schema("private").from("jumping_race_sessions").select("started_at,status,next_checkpoint").eq("id", b.sessionId).eq("player_id", userId).maybeSingle();
  if (se || !session) return json({ message: "Session unavailable" }, 404);
  const { data: batches, error: be } = await db.schema("private").from("jumping_race_action_batches").select("checkpoint_index,actions").eq("session_id", b.sessionId).order("checkpoint_index", { ascending: true }).limit(200);
  if (be || !batches) return json({ message: "Unable to verify" }, 503);
  if (batches.length !== session.next_checkpoint - 1 || batches.some((x,i) => x.checkpoint_index !== i + 1)) return json({ message: "Missing checkpoints" }, 409);
  const actions = parseJumpingRaceActions(batches.flatMap(x => x.actions as unknown[]));
  if (!actions) return json({ message: "Invalid replay" }, 409);
  const elapsed = Math.max(0, Math.floor(Date.now() - Date.parse(session.started_at)));
  const replay = replayJumpingRace(actions, elapsed);
  if (!replay || !replay.ended) return json({ message: "Run not complete or replay invalid" }, 409);
  const { data, error } = await db.rpc("jr_finalize_session", {
    p_session_id: b.sessionId, p_player_id: userId, p_score: replay.score,
    p_elapsed_ms: replay.elapsedMs, p_action_digest: digestJumpingRaceActions(actions),
    p_status: "verified", p_reason: null, p_telemetry: replay.telemetry,
  });
  if (error) return json({ message: "Unable to finalize" }, 409);
  return json({ result: Array.isArray(data) ? data[0] : data });
}
