import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("Flappy prize program keeps post-activation-only scoring, exact awards, RLS and no automatic payments", async () => {
  const sql = await read("supabase/migrations/20261026222128_flappy_real_prize_program.sql");
  for (const table of ["flappy_prize_program", "flappy_prize_period_results", "flappy_prize_winner_cases", "flappy_prize_winner_case_events"]) {
    assert.match(sql, new RegExp("alter table private\\." + table + " enable row level security"));
  }
  assert.match(sql, /s\.starts_at >= p\.activated_at/);
  assert.match(sql, /when 1 then 1500 when 2 then 300 when 3 then 200/);
  assert.match(sql, /if c\.state<>'approved' then raise exception 'Candidate approval unavailable'/);
  assert.match(sql, /'paymentsEnabled',false/);
  assert.match(sql, /perform public\.rtw_admin_transition_winner/);
  assert.match(sql, /on conflict\(week,player_id\) do nothing/);
});

test("Flappy monetary admin endpoint is same-origin, owner-gated, and server-calculated", async () => {
  const route = await read("app/api/admin/flappy-race/prizes/route.ts");
  assert.match(route, /request\.headers\.get\("origin"\) !== new URL\(request\.url\)\.origin/);
  assert.match(route, /getAuthorizedPrizeAdmin\(\)/);
  assert.match(route, /flappy_decide_prize_candidate/);
  assert.match(route, /flappy_admin_allocate_prize/);
  assert.doesNotMatch(route, /amountCents\s*:/);
  assert.doesNotMatch(route, /rankPosition\s*:/);
});

test("public Flappy status discloses activation but not automatic payment", async () => {
  const status = await read("components/game/flappy-tournament-status.tsx");
  assert.match(status, /prizeEffectiveAt/);
  assert.match(status, /payments never execute automatically/);
});
