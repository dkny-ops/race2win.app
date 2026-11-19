import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20261119051142_harden_jumping_race_session_verification.sql", import.meta.url), "utf8");
const startRoute = readFileSync(new URL("../app/api/jumping-race/start/route.ts", import.meta.url), "utf8");
const checkRoute = readFileSync(new URL("../app/api/jumping-race/human-check/route.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../lib/game/jumping-race/official-server.ts", import.meta.url), "utf8");

test("Jumping Race human verification is service-only, session-bound, and finalization-gated", () => {
  assert.match(migration, /verification_required boolean not null default false/i);
  assert.match(migration, /verification_nonce uuid/i);
  assert.match(migration, /verification_status text not null default 'pending'/i);
  assert.match(migration, /v_session\.verification_required and v_session\.verification_status <> 'verified'/i);
  assert.match(migration, /revoke all on function public\.jr_session_security_info/i);
  assert.match(migration, /grant execute on function public\.jr_session_security_info[\s\S]*to service_role/i);
  assert.match(startRoute, /jumping_race_session_verification/);
  assert.match(checkRoute, /verifyTurnstileToken\(record\.token, "jumping_race_session_verification", \{ expectedCdata: record\.nonce \}\)/);
  assert.match(server, /origin === new URL\(request\.url\)\.origin/);
});

test("Jumping Race migration has no financial tables or public player grant", () => {
  assert.doesNotMatch(migration, /prize_balances|prize_ledger|payouts|wallet/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:anon|authenticated)/i);
  assert.match(migration, /revoke all on function public\.jr_hourly_leaderboard\(timestamptz,integer,integer\) from public,anon,authenticated/i);
});
