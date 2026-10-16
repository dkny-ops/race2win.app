// Local-only release-candidate rehearsal. It neither loads .env files nor
// contacts Supabase: PGlite runs in process and is discarded when it closes.
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const removedHourlyTournamentMigrations = [
  "20261012155258_add_hourly_world_tournament.sql",
  "20261012161907_add_hourly_demo_sessions.sql",
  "20261012162556_add_hourly_demo_attempts.sql",
  "20261012212656_set_hourly_demo_base_attempts_to_five.sql",
  "20261012212852_pause_hourly_demo_clock_during_challenges.sql",
  "20261013002302_add_hourly_demo_world_score_ranking.sql",
  "20261013030000_allow_repeating_hourly_demo_challenges.sql",
];
const requiredWeeklyMigrations = [
  "20261011000100_gate_referral_days_on_replay_evidence.sql",
  "20261013175035_weekly_antifraud_review_gate.sql",
  "20261013212406_add_weekly_leader_human_verification.sql",
  "20261014034008_enforce_official_hourly_play_allowances_and_retire_share_rewards.sql",
];

const all = (await readdir(new URL("supabase/migrations/", root)))
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort();
for (const name of requiredWeeklyMigrations) assert.ok(all.includes(name), `missing required weekly migration: ${name}`);
for (const name of removedHourlyTournamentMigrations) assert.equal(all.includes(name), false, `removed hourly migration unexpectedly present: ${name}`);
const selected = all;
assert.deepEqual(selected.filter((name) => requiredWeeklyMigrations.includes(name)), requiredWeeklyMigrations);

const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id), not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key, name text);
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
  `);
  for (const name of selected) {
    const sql = await readFile(new URL(`supabase/migrations/${name}`, root), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into supabase_migrations.schema_migrations(version, name) values ($1, $2)", [name.slice(0, 14), name]);
    });
  }
  const count = Number((await db.query("select count(*) as count from supabase_migrations.schema_migrations")).rows[0].count);
  assert.equal(count, selected.length);
  for (const object of ["private.official_play_allowance_windows", "private.weekly_leader_human_verifications", "private.game_session_antifraud_observations"]) {
    assert.notEqual((await db.query("select to_regclass($1) as object", [object])).rows[0].object, null, `missing weekly release object: ${object}`);
  }
  for (const object of ["public.hourly_tournaments", "private.hourly_tournament_attempts", "private.hourly_demo_sessions"]) {
    assert.equal((await db.query("select to_regclass($1) as object", [object])).rows[0].object, null, `experimental hourly object unexpectedly present: ${object}`);
  }
  console.log(JSON.stringify({ result: "PASS", selectedMigrations: selected.length, removedHourlyMigrations: removedHourlyTournamentMigrations }, null, 2));
} finally {
  await db.close();
}
