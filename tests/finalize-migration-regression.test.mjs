import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("forward FINALIZE correction is repeatable, qualified, service-only and preserves game and financial rules", async () => {
  const sql = await read("supabase/migrations/20261010032418_fix_finalize_expired_lease_status.sql");
  assert.match(sql, /create or replace function public\.rtw_finalize_game_session_with_checkpoints/);
  assert.match(sql, /update public\.game_sessions as session[\s\S]*where session\.id = v_session\.id and session\.status = 'active'/);
  assert.match(sql, /for update/);
  assert.match(sql, /language plpgsql security definer set search_path = ''/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
  assert.doesNotMatch(sql, /create table|alter table|drop |prize_|payout|weekly_tournament_totals|daily_top_scores/i);
  assert.match(sql, /v_checkpoint_interval := 5000/);
  assert.match(sql, /v_checkpoint_interval := 1000/);
});

test("FINALIZE SQL ambiguity has a fixed diagnostic without provider details or user evidence", async () => {
  const route = await read("app/api/game-sessions/finalize/route.ts");
  assert.match(route, /finalizeError\.code === "42702"/);
  assert.match(route, /reason: "finalize_sql_ambiguity"/);
  assert.doesNotMatch(route, /console\.(?:error|log)\(finalizeError/);
});
