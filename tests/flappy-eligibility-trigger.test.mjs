import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261121180044_fix_flappy_preflight_trigger_binding.sql", import.meta.url), "utf8");

test("Flappy eligibility telemetry aliases unnest output before calculating input gaps", () => {
  assert.match(migration, /with ordinality as input_stream\(input_tick,input_index\)/);
  assert.match(migration, /select input_tick, lag\(input_tick\) over\(order by input_index\) previous_tick/);
  assert.match(migration, /array_agg\(input_tick - previous_tick\)/);
  assert.doesNotMatch(migration, /select array_agg\(value-lag_value\)/);
});

test("Flappy eligibility correction remains conservative and does not mutate history", () => {
  assert.match(migration, /missing_session_bound_preflight/);
  assert.match(migration, /new\.eligibility := case when v_perfect then 'under_review' else 'valid' end/);
  assert.match(migration, /automated_input_pattern/);
  assert.match(migration, /where session_id=new\.session_id and player_id=new\.player_id/);
  assert.match(migration, /verified_at is not null and consumed_at is not null/);
  assert.doesNotMatch(migration, /consumed_session_id|expires_at>=new\.completed_at/);
  assert.doesNotMatch(migration, /\bupdate\s+private\.flappy_(runs|sessions)\b/i);
});
