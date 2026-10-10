import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20260917000100_create_authoritative_game_session_checkpoints.sql", root), "utf8");
const finalizeMigration = await readFile(new URL("supabase/migrations/20260917000200_finalize_game_session_checkpoint_chain.sql", root), "utf8");
const finalizeHardening = await readFile(new URL("supabase/migrations/20260917000300_harden_checkpoint_finalization_inputs.sql", root), "utf8");
const checkpointProofReadMigration = await readFile(new URL("supabase/migrations/20260924000840_read_game_session_checkpoint_proofs.sql", root), "utf8");
const checkpointRoute = await readFile(new URL("app/api/game-sessions/checkpoint/route.ts", root), "utf8");
const finalizeRoute = await readFile(new URL("app/api/game-sessions/finalize/route.ts", root), "utf8");

async function compileModule(path, requireImpl = (name) => name === "server-only" ? {} : require(name)) {
  const source = await readFile(new URL(path, root), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  new Function("exports", "module", "require", output)(compiled.exports, compiled, requireImpl);
  return compiled.exports;
}

test("checkpoint helpers enforce versioned milestones and immutable evidence prefixes", async () => {
  const helpers = await compileModule("lib/game/race-to-win/checkpoints.ts");
  const inputs = [{ sequence: 0, atMs: 100, direction: 1 }, { sequence: 1, atMs: 500, direction: -1 }];
  assert.equal(helpers.checkpointCountForScore(999), 0);
  assert.equal(helpers.checkpointCountForScore(1_000), 1);
  assert.equal(helpers.checkpointCountForScore(14_999), 14);
  assert.equal(helpers.checkpointCountForScore(5_000, helpers.LEGACY_SCORE_CHECKPOINT_INTERVAL), 1);
  assert.equal(helpers.checkpointCountForScore(-1), -1);
  const proof = { checkpoint_index: 1, milestone_score: 1_000, proof_input_count: 1, proof_input_digest: helpers.digestOfficialInputs(inputs.slice(0, 1)) };
  assert.equal(helpers.proofMatchesInputs(proof, inputs), true);
  assert.equal(helpers.proofMatchesInputs(proof, [{ ...inputs[0], direction: -1 }, inputs[1]]), false);
  assert.equal(helpers.proofMatchesInputs({ ...proof, milestone_score: 2_000 }, inputs), false);
});

test("checkpoint parser rejects malformed, reordered, over-limit, and oversized streamed evidence", async () => {
  const inputs = await compileModule("lib/game/race-to-win/official-inputs.ts");
  assert.deepEqual(inputs.parseOfficialInputs([{ sequence: 0, atMs: 0, direction: 1 }], 2), [{ sequence: 0, atMs: 0, direction: 1 }]);
  assert.equal(inputs.parseOfficialInputs([{ sequence: 1, atMs: 0, direction: 1 }], 2), null);
  assert.equal(inputs.parseOfficialInputs([{ sequence: 0, atMs: 10, direction: 1 }, { sequence: 1, atMs: 9, direction: -1 }], 2), null);
  const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(inputs.OFFICIAL_SESSION_BODY_LIMIT_BYTES + 1)); controller.close(); } });
  const request = new Request("https://example.test/checkpoint", { method: "POST", body: oversized, duplex: "half" });
  assert.equal(await inputs.readOfficialSessionJson(request), null);
});

test("checkpoint persistence is private, RLS-protected, ordered, and rate limited", () => {
  assert.match(migration, /create table private\.game_session_checkpoints/);
  assert.match(migration, /primary key \(game_session_id, checkpoint_index\)/);
  assert.match(migration, /milestone_score = checkpoint_index \* 5000/);
  assert.match(migration, /alter table private\.game_session_checkpoints enable row level security/);
  assert.match(migration, /revoke all on table private\.game_session_checkpoints from public, anon, authenticated/);
  assert.match(migration, /grant select, insert on table private\.game_session_checkpoints to service_role/);
  assert.match(migration, /for update/);
  assert.match(migration, /when 'game_checkpoint' then v_limit := 18/);
  assert.match(migration, /revoke all on function private\.prune_expired_game_session_checkpoints/);
});

test("checkpoint and finalization paths share replay evidence without financial or leaderboard writes", () => {
  assert.match(checkpointRoute, /getVerifiedPlayerId\(\)/);
  assert.match(checkpointRoute, /replayAuthoritativeProgress/);
  assert.match(checkpointRoute, /consumeCompetitionActionRateLimit\(playerId, "game_checkpoint"\)/);
  assert.match(checkpointRoute, /proofMatchesInputs/);
  assert.match(checkpointRoute, /rpc\("rtw_read_game_session_checkpoint_proofs"/);
  assert.doesNotMatch(checkpointRoute, /\.schema\("private"\)/);
  assert.doesNotMatch(finalizeRoute, /\.schema\("private"\)/);
  assert.match(finalizeRoute, /rpc\("rtw_read_game_session_checkpoint_proofs"/);
  assert.doesNotMatch(checkpointRoute, /validated_runs|daily_top_scores|weekly_tournament_totals|prize_ledger|payout/i);
  assert.match(finalizeRoute, /checkpointCountForScore\(replay\.score, checkpointInterval\)/);
  assert.match(finalizeRoute, /rtw_finalize_game_session_with_checkpoints/);
  assert.match(finalizeRoute, /proofMatchesInputs/);
  assert.match(finalizeMigration, /for update/);
  assert.match(finalizeMigration, /p_checkpoint_proofs is null/);
  assert.match(finalizeHardening, /proof\.value/);
  assert.match(finalizeMigration, /revoke all on function public\.rtw_finalize_game_session_with_checkpoints/);
});

test("checkpoint proof reads use a minimum, service-role-only read-only RPC", () => {
  assert.match(checkpointProofReadMigration, /create function public\.rtw_read_game_session_checkpoint_proofs\(\s*p_session_id uuid,\s*p_player_id uuid/s);
  assert.match(checkpointProofReadMigration, /returns table \(\s*checkpoint_index integer,\s*milestone_score integer,\s*proof_input_digest text,\s*proof_input_count integer\s*\)/s);
  assert.match(checkpointProofReadMigration, /security definer\s+set search_path = ''/s);
  assert.match(checkpointProofReadMigration, /p_session_id is null or p_player_id is null/);
  assert.match(checkpointProofReadMigration, /from public\.game_sessions as session/);
  assert.match(checkpointProofReadMigration, /session\.id = p_session_id\s+and session\.user_id = p_player_id/s);
  assert.match(checkpointProofReadMigration, /from private\.game_session_checkpoints as checkpoint/);
  assert.match(checkpointProofReadMigration, /revoke all on function public\.rtw_read_game_session_checkpoint_proofs\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(checkpointProofReadMigration, /grant execute on function public\.rtw_read_game_session_checkpoint_proofs\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(checkpointProofReadMigration, /\b(?:insert|update|delete)\b/i);
  assert.doesNotMatch(checkpointProofReadMigration, /execute\s+(?!on function)/i);
});

test("scores read API has bounded allowlisted public queries and derives personal identity server-side", async () => {
  const scores = await readFile(new URL("lib/competition/scores.ts", root), "utf8");
  const meRoute = await readFile(new URL("app/api/scores/me/route.ts", root), "utf8");
  const leaderboardRoute = await readFile(new URL("app/api/leaderboard/route.ts", root), "utf8");
  assert.match(meRoute, /getVerifiedPlayerId\(\)/);
  assert.doesNotMatch(meRoute, /searchParams|userId/);
  assert.match(scores, /pageSize > 50/);
  assert.match(scores, /page > 100/);
  assert.match(scores, /rank_position/);
  assert.doesNotMatch(scores, /individual_scores/);
  assert.match(leaderboardRoute, /Cache-Control": "no-store/);
  assert.doesNotMatch(leaderboardRoute, /stale-while-revalidate|s-maxage=/);
});
