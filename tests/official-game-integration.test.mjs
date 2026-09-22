import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("official start returns a server schedule through a service-only function", async () => {
  const migration = await read("supabase/migrations/20260922000100_return_official_session_start_time.sql");
  const route = await read("app/api/game-sessions/start/route.ts");
  assert.match(migration, /create function public\.rtw_start_official_game_session_v2/);
  assert.match(migration, /started_at timestamptz/);
  assert.match(migration, /v_now \+ interval '3 seconds'/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.rtw_start_official_game_session_v2[^\n]+from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rtw_start_official_game_session_v2[^\n]+to service_role/);
  assert.match(route, /getVerifiedUserContext\(\)/);
  assert.match(route, /rtw_start_official_game_session_v2/);
  assert.match(route, /startsAt: session\.started_at/);
  assert.doesNotMatch(route, /request\.json\(\)/);
});

test("the gameplay client supplies evidence only and renders only a returned official outcome", async () => {
  const scene = await read("components/game/race-to-win/race-to-win-scene.tsx");
  assert.match(scene, /fetch\("\/api\/game-sessions\/start"/);
  assert.match(scene, /simulation\.reset\(session\.seed\)/);
  assert.match(scene, /session\.gameplayVersion !== GAMEPLAY_VERSION/);
  assert.match(scene, /fetch\("\/api\/game-sessions\/checkpoint"/);
  assert.match(scene, /checkpointIndex, inputs/);
  assert.doesNotMatch(scene, /checkpointIndex, score/);
  assert.match(scene, /CHECKPOINT_RETRY_LIMIT = 2/);
  assert.match(scene, /fetch\("\/api\/game-sessions\/finalize"/);
  assert.match(scene, /setOfficialOutcome\(outcome\)/);
  assert.match(scene, /OFFICIAL SCORE/);
  assert.match(scene, /No official score was recorded/);
  assert.doesNotMatch(scene, /localStorage/);
  assert.doesNotMatch(scene, /userId/);
});

test("anonymous entry is gated and the post-OTP redirect is a fixed allowlist", async () => {
  const game = await read("components/game/race-to-win/race-to-win-game.tsx");
  const page = await read("app/games/race-to-win/page.tsx");
  const nextPath = await read("lib/auth/post-auth-path.ts");
  const requestCode = await read("app/api/auth/request-code/route.ts");
  const verifyCode = await read("app/api/auth/verify-code/route.ts");
  assert.match(page, /getVerifiedUserContext\(\)/);
  assert.match(game, /canStartOfficial/);
  assert.match(game, /SIGN IN TO RACE/);
  assert.match(nextPath, /value === ROUTES\.raceToWinGame/);
  assert.match(requestCode, /safePostAuthPath/);
  assert.match(requestCode, /rtw_otp_next/);
  assert.match(verifyCode, /safePostAuthPath/);
  assert.match(verifyCode, /nextPath/);
});

test("checkpoint client requests cannot create competitive or financial state", async () => {
  const scene = await read("components/game/race-to-win/race-to-win-scene.tsx");
  assert.doesNotMatch(scene, /weekly_tournament_totals|daily_top_scores|validated_runs|prize_ledger|payout/i);
  assert.match(scene, /The server will validate the complete run at the finish/);
});
