import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261118160000_add_jumping_race_prize_program.sql", "utf8");

test("Jumping Race prize program installs dormant and uses the shared wallet only after owner review", () => {
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /lower\(u\.email\) = lower\('racetowinapp@gmail\.com'\)/);
  assert.match(migration, /u\.email_confirmed_at is not null/);
  assert.match(migration, /when 1 then 500 when 2 then 300 when 3 then 200/);
  assert.match(migration, /result_status = 'verified'/);
  assert.match(migration, /daily_rank <= 7/);
  assert.match(migration, /p\.activated_at/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /for update/);
  assert.match(migration, /on conflict \(week, player_id\) do nothing/);
  assert.match(migration, /on conflict \(slug\) do nothing/);
  assert.match(migration, /paymentsEnabled', false/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/);
});

test("Jumping Race prize migration has no direct historical balance or payout mutation", () => {
  assert.doesNotMatch(migration, /update\s+public\.prize_balances/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.prize_ledger_entries/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.payouts/i);
  assert.doesNotMatch(migration, /update\s+public\.payouts/i);
});
