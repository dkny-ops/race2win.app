import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20261119051142_harden_jumping_race_session_verification.sql", import.meta.url), "utf8");
const finalPrepareMigration = readFileSync(new URL("../supabase/migrations/20261122232018_jumping_race_final_human_prepare.sql", import.meta.url), "utf8");
const finalGuardMigration = readFileSync(new URL("../supabase/migrations/20261122232251_jumping_race_final_human_finalize_guard.sql", import.meta.url), "utf8");
const startRoute = readFileSync(new URL("../app/api/jumping-race/start/route.ts", import.meta.url), "utf8");
const checkRoute = readFileSync(new URL("../app/api/jumping-race/human-check/route.ts", import.meta.url), "utf8");
const finalChallengeRoute = readFileSync(new URL("../app/api/jumping-race/finalize-challenge/route.ts", import.meta.url), "utf8");
const finalCheckRoute = readFileSync(new URL("../app/api/jumping-race/finalize-human-check/route.ts", import.meta.url), "utf8");
const finalizeRoute = readFileSync(new URL("../app/api/jumping-race/finalize/route.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../lib/game/jumping-race/official-server.ts", import.meta.url), "utf8");
const game = readFileSync(new URL("../components/game/jumping-race-game.tsx", import.meta.url), "utf8");

test("Jumping Race human verification is service-only, session-bound, and finalization-gated", () => {
  assert.match(migration, /verification_required boolean not null default false/i);
  assert.match(migration, /verification_nonce uuid/i);
  assert.match(migration, /verification_status text not null default 'pending'/i);
  assert.match(migration, /v_session\.verification_required and v_session\.verification_status <> 'verified'/i);
  assert.match(migration, /revoke all on function public\.jr_session_security_info/i);
  assert.match(migration, /grant execute on function public\.jr_session_security_info[\s\S]*to service_role/i);
  // Cloudflare limits action values to 32 characters. This is the shared
  // production action used by the widget, start gate and Siteverify call.
  assert.match(startRoute, /getTurnstileWidgetConfiguration\("jumping_race_verify"\)/);
  assert.match(checkRoute, /verifyTurnstileToken\(record\.token, "jumping_race_verify", \{ expectedCdata: record\.nonce \}\)/);
  assert.match(game, /action: "jumping_race_verify"/);
  assert.match(game, /Official score not saved:/);
  assert.match(game, /\{officialNotice\}/);
  assert.match(server, /origin === new URL\(request\.url\)\.origin/);
});

test("Jumping Race migration has no financial tables or public player grant", () => {
  assert.doesNotMatch(migration, /prize_balances|prize_ledger|payouts|wallet/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:anon|authenticated)/i);
  assert.match(migration, /revoke all on function public\.jr_hourly_leaderboard\(timestamptz,integer,integer\) from public,anon,authenticated/i);
});

test("Jumping Race requires an independent final human proof before an official result", () => {
  assert.match(finalPrepareMigration, /final_verification_required boolean not null default false/i);
  assert.match(finalPrepareMigration, /final_verification_nonce uuid/i);
  assert.match(finalPrepareMigration, /final_verification_status text not null default 'pending'/i);
  assert.match(finalPrepareMigration, /set final_verification_nonce=gen_random_uuid\(\)/i);
  assert.match(finalPrepareMigration, /jr_prepare_finalize_human/i);
  assert.match(finalPrepareMigration, /jr_verify_finalize_human/i);
  assert.match(finalPrepareMigration, /public\.jr_prepare_finalize_human\(uuid,uuid\)[\s\S]*from public,anon,authenticated/i);
  assert.match(finalPrepareMigration, /public\.jr_prepare_finalize_human\(uuid,uuid\)[\s\S]*to service_role/i);
  assert.match(finalGuardMigration, /v_session\.final_verification_required and v_session\.final_verification_status <> 'verified'/i);
  assert.match(finalChallengeRoute, /jr_prepare_finalize_human/);
  assert.match(finalCheckRoute, /verifyTurnstileToken\(record\.token, "jumping_race_finalize", \{ expectedCdata: record\.nonce \}\)/);
  assert.match(finalCheckRoute, /jr_verify_finalize_human/);
  assert.match(finalizeRoute, /session\.final_verification_required === true && session\.final_verification_status !== "verified"/);
  assert.match(game, /"\/api\/jumping-race\/finalize-challenge"/);
  assert.match(game, /"jumping_race_finalize"/);
  assert.match(game, /Checking final human verification/);
  assert.match(game, /finishOfficial\(run\)\.finally\(returnToStart\)/);
});

test("Final verification migrations remain financial-data free and service-only", () => {
  const sql = `${finalPrepareMigration}\n${finalGuardMigration}`;
  assert.doesNotMatch(sql, /prize_balances|prize_ledger|payouts|wallet/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to (?:anon|authenticated)/i);
});
