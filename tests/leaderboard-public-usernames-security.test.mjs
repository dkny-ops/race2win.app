import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ranked public-username lookup is a narrow server-only bridge", async () => {
  const migration = await read("supabase/migrations/20261004000100_read_ranked_public_usernames.sql");
  assert.match(migration, /returns table\s*\(\s*player_id uuid,\s*username text\s*\)/s);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /owner to postgres/);
  assert.match(migration, /cardinality\(p_player_ids\) > 50/);
  assert.match(migration, /array_position\(p_player_ids, null::uuid\)/);
  assert.match(migration, /join requested on requested\.player_id = total\.player_id/);
  assert.match(migration, /total\.game_id = p_game_id/);
  assert.match(migration, /total\.tournament_week_start = p_tournament_week_start/);
  assert.match(migration, /revoke all on function public\.rtw_read_ranked_public_usernames\(uuid, date, uuid\[\]\) from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.rtw_read_ranked_public_usernames\(uuid, date, uuid\[\]\) to service_role;/);
  assert.doesNotMatch(migration, /paypal_email|created_at|updated_at|select \*/i);
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+table\s+public\.profiles/i);
});

test("leaderboard uses the narrow RPC and never reads profiles directly", async () => {
  const scores = await read("lib/competition/scores.ts");
  assert.match(scores, /rpc\("rtw_read_ranked_public_usernames"/);
  assert.match(scores, /p_game_id: game\.id/);
  assert.match(scores, /p_tournament_week_start: params\.week/);
  assert.match(scores, /p_player_ids: playerIds/);
  assert.doesNotMatch(scores, /from\("profiles"\)/);
  assert.match(scores, /order\("rank_position", \{ ascending: true \}\)/);
  assert.match(scores, /range\(from, to\)/);
  assert.doesNotMatch(scores, /individual_scores|paypal_email|payout|ledger|prize/i);
});

test("profile ownership remains distinct from the server-only public-name bridge", async () => {
  const profiles = await read("supabase/migrations/20260904000100_create_profiles.sql");
  assert.match(profiles, /enable row level security/);
  assert.match(profiles, /Profiles are readable by their owner/);
  assert.match(profiles, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(profiles, /grant select on table public\.profiles to anon/i);
});
