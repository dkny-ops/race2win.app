import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
async function source(path) { return readFile(new URL(path, root), "utf8"); }

test("weekly leadership verification is server-scoped, held, and browser-inaccessible", async () => {
  const [migration, route, turnstile, scene] = await Promise.all([
    source("supabase/migrations/20261013212406_add_weekly_leader_human_verification.sql"),
    source("app/api/game-sessions/leader-verification/route.ts"),
    source("lib/security/turnstile.ts"),
    source("components/game/race-to-win/race-to-win-scene.tsx"),
  ]);
  assert.match(migration, /weekly_leader_human_verifications/);
  assert.match(migration, /gameplay_version = 'rtw-v7'/);
  assert.match(migration, /tie_break_status = 'resolved'/);
  assert.match(migration, /app\.rtw_weekly_leader_human_verification/);
  assert.match(migration, /revoke all on function public\.rtw_read_weekly_leader_human_verification[\s\S]*anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rtw_read_weekly_leader_human_verification[\s\S]*to service_role/);
  assert.match(migration, /Tokens are never stored/);
  assert.match(route, /verifyTurnstileToken\(token, "weekly_leader_verification"\)/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /rtw_verify_weekly_leader_human_verification/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(turnstile, /"weekly_leader_verification"/);
  assert.match(scene, /WEEKLY LEADER VERIFICATION/);
  assert.match(scene, /Your verified score is saved, but it is held out of prize eligibility/);
});

test("Turnstile remains a step-up, never an authority for the driving replay or payments", async () => {
  const [finalize, migration, scene] = await Promise.all([
    source("app/api/game-sessions/finalize/route.ts"),
    source("supabase/migrations/20261013212406_add_weekly_leader_human_verification.sql"),
    source("components/game/race-to-win/race-to-win-scene.tsx"),
  ]);
  assert.match(finalize, /replayAuthoritativeProgress/);
  assert.match(migration, /no token argument and cannot be used as a token-verification bypass/i);
  assert.match(migration, /no new result, session, or prize/);
  assert.doesNotMatch(migration, /insert into public\.prize_ledger_entries[\s\S]*weekly_leader_human/);
  assert.match(scene, /OFFICIAL SCORE/);
});
