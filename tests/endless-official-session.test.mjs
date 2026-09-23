import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

async function compileModule(path) {
  const source = await read(path);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function("exports", "module", "require", output)(compiled.exports, compiled, (name) => name === "server-only" ? {} : require(name));
  return compiled.exports;
}

test("rtw-v7 checkpoint cadence is reachable before its server activity lease expires", async () => {
  const config = await compileModule("lib/game/race-to-win/config.ts");
  const checkpoints = await compileModule("lib/game/race-to-win/checkpoints.ts");
  const worstCaseSeconds = checkpoints.SCORE_CHECKPOINT_INTERVAL /
    (config.DEFAULT_RACE_TO_WIN_CONFIG.initialSpeedMps * config.DEFAULT_RACE_TO_WIN_CONFIG.scorePerMeter);

  assert.equal(config.GAMEPLAY_VERSION, "rtw-v7");
  assert.equal(checkpoints.SCORE_CHECKPOINT_INTERVAL, 1_000);
  assert.equal(checkpoints.OFFICIAL_ACTIVITY_LEASE_SECONDS, 360);
  // The minimum velocity is a conservative bound because the versioned speed
  // curve never falls below initialSpeedMps.
  assert.ok(worstCaseSeconds + checkpoints.OFFICIAL_CHECKPOINT_NETWORK_MARGIN_SECONDS < checkpoints.OFFICIAL_ACTIVITY_LEASE_SECONDS);
  assert.equal(checkpoints.checkpointCountForScore(10_000), 10);
});

test("renewable lease migration removes v7 absolute gameplay expiry without weakening database ownership", async () => {
  const migration = await read("supabase/migrations/20260922000200_add_endless_official_session_leases.sql");
  assert.match(migration, /add column if not exists activity_lease_expires_at timestamptz/);
  assert.match(migration, /checkpoint_interval_score is null or checkpoint_interval_score = 1000/);
  assert.match(migration, /game_sessions_versioned_checkpoint_lease_shape/);
  assert.doesNotMatch(migration, /update public\.game_sessions\s+set checkpoint_interval_score/i);
  assert.match(migration, /create function public\.rtw_start_official_game_session_v3/);
  assert.match(migration, /p_gameplay_version <> 'rtw-v7'/);
  assert.match(migration, /v_lease_expires_at timestamptz := v_started_at \+ interval '6 minutes'/);
  assert.match(migration, /create function public\.rtw_record_game_session_checkpoint_with_lease/);
  assert.match(migration, /for update/);
  assert.match(migration, /activity_lease_expires_at <= v_now/);
  assert.match(migration, /set_config\('rtw\.activity_lease_renewal', 'validated', true\)/);
  assert.match(migration, /new\.activity_lease_expires_at <= old\.activity_lease_expires_at/);
  assert.match(migration, /lease_renewed/);
  assert.match(migration, /revoke all on function public\.rtw_record_game_session_checkpoint_with_lease/);
  assert.match(migration, /grant execute on function public\.rtw_record_game_session_checkpoint_with_lease[^\n]+to service_role/);
  assert.match(migration, /revoke insert on table private\.game_session_checkpoints from service_role/);

  const finalizer = migration.slice(migration.indexOf("create or replace function public.rtw_finalize_game_session_with_checkpoints"));
  assert.match(finalizer, /v_session\.activity_lease_expires_at <= v_now/);
  assert.match(finalizer, /v_session\.checkpoint_interval_score/);
  // Legacy rtw-v6 finalization retains its original fixed expiry, while the
  // new rtw-v7 branch alone consults the renewable lease.
  assert.match(finalizer, /if v_session\.gameplay_version = 'rtw-v6' then[\s\S]*v_session\.expires_at <= v_now/);
  assert.match(finalizer, /if v_session\.gameplay_version = 'rtw-v7' and v_session\.activity_lease_expires_at <= v_now then/);
});

test("endless migration preserves immutable rtw-v6 rows and scopes renewable leases to new rtw-v7 sessions", async () => {
  const migration = await read("supabase/migrations/20260922000200_add_endless_official_session_leases.sql");

  assert.match(migration, /gameplay_version = 'rtw-v6'\s+and checkpoint_interval_score is null\s+and activity_lease_expires_at is null/s);
  assert.match(migration, /gameplay_version = 'rtw-v7'\s+and checkpoint_interval_score = 1000\s+and activity_lease_expires_at is not null/s);
  assert.match(migration, /if old\.gameplay_version = 'rtw-v6' then/);
  assert.match(migration, /raise exception 'An active session cannot be rewritten\.'/);
  assert.match(migration, /if v_session\.gameplay_version <> 'rtw-v7'/);
  assert.match(migration, /v_checkpoint_interval := 5000/);
  assert.match(migration, /v_checkpoint_interval := 1000/);
  assert.doesNotMatch(migration, /disable trigger|alter table public\.game_sessions disable/i);
});

test("server routes use per-session interval and canonical database lease renewal only", async () => {
  const start = await read("app/api/game-sessions/start/route.ts");
  const checkpoint = await read("app/api/game-sessions/checkpoint/route.ts");
  const finalize = await read("app/api/game-sessions/finalize/route.ts");
  const scene = await read("components/game/race-to-win/race-to-win-scene.tsx");

  assert.match(start, /rtw_start_official_game_session_v3/);
  assert.match(start, /checkpointInterval/);
  assert.match(start, /activityLeaseExpiresAt/);
  assert.match(checkpoint, /rtw_record_game_session_checkpoint_with_lease/);
  assert.match(checkpoint, /checkpoint_interval_score/);
  assert.doesNotMatch(checkpoint, /\.insert\(missing\)/);
  assert.match(finalize, /checkpointCountForScore\(replay\.score, checkpointInterval\)/);
  assert.doesNotMatch(finalize, /Date\.parse\(session\.expires_at\)/);
  assert.match(scene, /session\.checkpointInterval/);
  assert.doesNotMatch(scene, /CHECKPOINT_INTERVAL =/);
});

test("lease checkpoints remain non-financial and browser evidence never includes authority fields", async () => {
  const checkpoint = await read("app/api/game-sessions/checkpoint/route.ts");
  assert.match(checkpoint, /replayAuthoritativeProgress/);
  assert.doesNotMatch(checkpoint, /validated_runs|daily_top_scores|weekly_tournament_totals|prize_ledger|payout/i);
  assert.doesNotMatch(checkpoint, /authoritativeScore|clientScore|userId:/);
});
