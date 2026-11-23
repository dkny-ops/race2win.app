import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20261123120000_auto_close_jumping_race_prize_period.sql", import.meta.url), "utf8");
const links = readFileSync(new URL("../components/game/other-game-admin-links.tsx", import.meta.url), "utf8");

test("Jumping automatic closure freezes only the immediately previous NY week and never enables payments", () => {
  assert.match(migration, /p_week is distinct from v_previous_week/i);
  assert.match(migration, /interval '11 minutes'/i);
  assert.match(migration, /jr_auto_close_previous_week/i);
  assert.match(migration, /'30 5 \* \* \*'/);
  assert.match(migration, /paymentsEnabled', false/i);
  assert.doesNotMatch(migration, /rtw_owner_confirm_full_balance_paid|prize_balances|payouts/i);
});

test("cross-game dossier links stay inside owner-only administrative routes", () => {
  assert.match(links, /getAuthorizedPrizeAdmin/);
  assert.match(links, /\/admin\/prize-review\/players\?q=/);
  assert.match(links, /\/admin\/prize-review\/flappy-race\/players\?q=/);
  assert.match(links, /\/admin\/prize-review\/jumping-race\?player=/);
  assert.match(links, /GANADOR PROVISIONAL/);
  assert.doesNotMatch(links, /NEXT_PUBLIC_|service_role/i);
});
