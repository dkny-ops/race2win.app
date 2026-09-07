import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260907000100_create_competition_foundation.sql", import.meta.url), "utf8");

test("competition tables are RLS-protected and unavailable to browser roles", () => {
  const tables = [
    "games", "validated_runs", "daily_top_scores", "weekly_tournament_totals",
    "referral_codes", "referrals", "referral_qualification_days", "weekly_share_results",
    "ad_reward_claims", "fraud_flags", "fraud_reviews", "provisional_winners",
    "prize_ledger_entries", "prize_balances", "payouts",
  ];
  for (const table of tables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`));
  }
  assert.doesNotMatch(migration, /grant\s+[^;]*\s+on table public\.(?:validated_runs|daily_top_scores|weekly_tournament_totals|referrals|prize_balances)[^;]*\s+to authenticated/i);
});

test("validated results are created only by a finalized server-owned session", () => {
  assert.match(migration, /create trigger game_sessions_materialize_validated_run\s+after update of status on public\.game_sessions/i);
  assert.match(migration, /insert into public\.validated_runs \(game_session_id\)/i);
  assert.match(migration, /v_session\.status <> 'finalized'/);
  assert.match(migration, /new\.score := v_session\.final_score;/);
  assert.match(migration, /new\.tournament_day := private\.ny_tournament_day\(v_completed_at\);/);
});

test("ranking rules materialize Top 7 and exact weekly tie-break vectors", () => {
  assert.match(migration, /where ranked\.daily_rank <= 7;/);
  assert.match(migration, /array_agg\(run\.score order by run\.score desc, run\.completed_at asc, run\.id asc\)/);
  assert.match(migration, /order by total\.weekly_total_score desc, total\.individual_scores desc, total\.player_id asc/);
  assert.match(migration, /America\/New_York/);
});

test("referrals and prize rewards remain server-only and auditable", () => {
  assert.match(migration, /constraint referrals_not_self check \(inviter_user_id <> invitee_user_id\)/);
  assert.match(migration, /create function private\.prevent_referral_relationship_change\(\)/);
  assert.match(migration, /create function public\.rtw_attach_referral[\s\S]*security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /v_qualified_day_count >= 5/);
  assert.match(migration, /having count\(\*\) >= 3/);
  assert.match(migration, /create trigger ad_reward_claims_guard/);
  assert.match(migration, /game_session_id uuid not null unique references public\.game_sessions/);
  assert.match(migration, /create trigger prize_ledger_prevent_mutation/);
  assert.match(migration, /revoke all on function public\.rtw_begin_prize_claim\(uuid, uuid\) from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.rtw_begin_prize_claim\(uuid, uuid\) to service_role;/);
});
