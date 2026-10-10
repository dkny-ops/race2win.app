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

test("leaderboard filters public usernames before pagination through a narrow server-only projection", async () => {
  const [migration, scores] = await Promise.all([
    read("supabase/migrations/20261005014540_read_public_leaderboard_page_metadata.sql"),
    read("lib/competition/scores.ts"),
  ]);
  assert.match(migration, /returns jsonb/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /owner to postgres/);
  assert.match(migration, /profile\.username is not null/);
  assert.match(migration, /char_length\(profile\.username\) between 1 and 40/);
  assert.match(migration, /'total_public_entries', \(select count\(\*\) from public_rows\)/);
  assert.match(migration, /'entries', coalesce\(/);
  assert.match(migration, /'\[\]'::jsonb/);
  assert.match(migration, /order by public_rows\.rank_position asc, public_rows\.player_id asc/);
  assert.match(migration, /offset \(p_page - 1\) \* p_page_size/);
  assert.match(migration, /p_page > 100/);
  assert.match(migration, /p_page_size > 50/);
  assert.match(migration, /revoke all on function public\.rtw_read_public_leaderboard_page_metadata\(uuid, date, integer, integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rtw_read_public_leaderboard_page_metadata\(uuid, date, integer, integer\) to service_role/);
  assert.doesNotMatch(migration, /player_id uuid|email|paypal|individual_scores|payout|ledger|prize/i);
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+table\s+public\.profiles/i);
  assert.match(scores, /rpc\("rtw_read_public_leaderboard_page_metadata"/);
  assert.match(scores, /p_page: params\.page/);
  assert.match(scores, /p_page_size: params\.pageSize/);
  assert.match(scores, /hasNextPage: params\.page \* params\.pageSize < totalPublicEntries/);
  assert.doesNotMatch(scores, /from\("profiles"\)|\.range\(from, to\)/);
  assert.doesNotMatch(scores, /individual_scores|paypal_email|payout|ledger|prize/i);
});

test("leaderboard metadata handles empty, final, and out-of-range pages without guessing from rows", () => {
  const hasNext = (total, page, pageSize) => page * pageSize < total;
  assert.equal(hasNext(0, 1, 25), false, "empty leaderboard");
  assert.equal(hasNext(50, 2, 25), false, "exact final page");
  assert.equal(hasNext(51, 2, 25), true, "partial final page follows");
  assert.equal(hasNext(23, 2, 25), false, "out-of-range page stays terminal");
});

test("scores UI uses a unique public username for highlighting and clears stale world data", async () => {
  const [member, guest] = await Promise.all([
    read("components/scores/my-race-stats.tsx"),
    read("components/scores/guest-race-stats.tsx"),
  ]);
  assert.match(member, /publicUsername: string \| null/);
  assert.match(member, /personal\?\.publicUsername === entry\.username/);
  assert.doesNotMatch(member, /personal\?\.rank === entry\.rank/);
  for (const source of [member, guest]) {
    assert.match(source, /const controller = new AbortController\(\)/);
    assert.match(source, /setLeaderboard\(null\)/);
    assert.match(source, /controller\.abort\(\)/);
    assert.match(source, /disabled=\{!leaderboard\.hasNextPage\}/);
  }
});

test("profile ownership remains distinct from the server-only public-name bridge", async () => {
  const profiles = await read("supabase/migrations/20260904000100_create_profiles.sql");
  assert.match(profiles, /enable row level security/);
  assert.match(profiles, /Profiles are readable by their owner/);
  assert.match(profiles, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(profiles, /grant select on table public\.profiles to anon/i);
  assert.match(profiles, /create unique index profiles_username_lower_key/);
  assert.match(profiles, /on public\.profiles \(lower\(username\)\)/);
  assert.match(profiles, /where username is not null/);
  assert.match(profiles, /Username cannot be changed once set/);
});
