import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("official five-play allowance is private, server-only, atomic, and DST-safe", async () => {
  const migration = await read("supabase/migrations/20261014034008_enforce_official_hourly_play_allowances_and_retire_share_rewards.sql");
  assert.match(migration, /free_plays_consumed between 0 and 5/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /official_play_start_requests/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /date_trunc\('hour', p_at\)/);
  assert.match(migration, /revoke all on table private\.official_play_allowance_windows.*anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rtw_start_official_game_session_v4.*service_role/);
  assert.match(migration, /No official plays remain for this New York hour/);
});

test("rewarded plays require provider-verifiable server evidence and never touch money", async () => {
  const migration = await read("supabase/migrations/20261014034008_enforce_official_hourly_play_allowances_and_retire_share_rewards.sql");
  const scene = await read("components/game/race-to-win/race-to-win-scene.tsx");
  assert.match(migration, /provider_event_id text not null unique/);
  assert.match(migration, /status in \('issued','consumed','expired'\)/);
  assert.doesNotMatch(migration, /create (or replace )?function public\.rtw_grant_rewarded_play/i);
  assert.match(scene, /WATCH AD FOR \+1 PLAY/);
  assert.match(scene, /UNAVAILABLE/);
});

test("Share is voluntary social navigation only, not a competition or reward source", async () => {
  const home = await read("app/page.tsx");
  const share = await read("components/share/share-campaign.tsx");
  const migration = await read("supabase/migrations/20261014034008_enforce_official_hourly_play_allowances_and_retire_share_rewards.sql");
  assert.doesNotMatch(home, /readWeeklyShareLeaderboard/);
  assert.doesNotMatch(share, /SHARE TOP 10|WEEKLY \$10 POOL|WEEKLY SHARE CHALLENGE/);
  assert.match(share, /WHATSAPP.*FACEBOOK.*TELEGRAM.*COPY LINK/s);
  assert.match(migration, /no future validated run[\s\S]*mint a weekly-share prize/);
});
