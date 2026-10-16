import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("historical Share leaderboard projection remains service-only but is absent from the active web flow", async () => {
  const [migration, home] = await Promise.all([
    read("supabase/migrations/20261004000200_read_weekly_share_leaderboard.sql"),
    read("app/page.tsx"),
  ]);
  assert.match(migration, /returns table\s*\(\s*rank_position integer,\s*username text,\s*confirmed_share_count integer/s);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /owner to postgres/);
  assert.match(migration, /p_limit > 10/);
  assert.match(migration, /revoke all on function public\.rtw_read_weekly_share_leaderboard\(uuid, date, integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rtw_read_weekly_share_leaderboard\(uuid, date, integer\) to service_role/);
  assert.doesNotMatch(migration, /select \*|paypal|email|payout|ledger|prize_balances/i);
  assert.doesNotMatch(home, /WeeklyShareLeaderboard|rtw_read_weekly_share_leaderboard|weekly_share_results/i);
});

test("Share UI obtains a personal link and attaches referrals only through authenticated server endpoints", async () => {
  const [home, campaign, postAuth, verify] = await Promise.all([
    read("app/page.tsx"),
    read("components/share/share-campaign.tsx"),
    read("lib/auth/post-auth-path.ts"),
    read("app/sign-in/verify/verify-code-form.tsx"),
  ]);
  assert.match(home, /<ShareCampaign/);
  assert.match(home, /normalizeReferralCode/);
  assert.match(campaign, /fetch\("\/api\/referrals\/code"/);
  assert.match(campaign, /fetch\("\/api\/referrals\/attach"/);
  assert.match(campaign, /JOIN WITH THIS INVITE/);
  assert.match(campaign, /navigator\.share/);
  assert.match(campaign, /new URL\(window\.location\.origin\)/);
  assert.match(campaign, /url\.protocol !== "https:" && url\.hostname !== "localhost"/);
  assert.match(campaign, /url\.pathname = "\/"/);
  assert.match(campaign, /url\.hash = ""/);
  assert.match(campaign, /error\.name === "AbortError"/);
  assert.match(campaign, /Share canceled\./);
  assert.match(campaign, /Sharing is optional and does not award points or prizes/);
  assert.doesNotMatch(campaign, /Top 10|weekly share|\$10|confirmed share/i);
  assert.match(campaign, /JSON\.stringify\(\{ code: referralCode \}\)/);
  assert.doesNotMatch(campaign, /JSON\.stringify\(\{[^}]*\b(?:userId|playerId|score|balance|payout|prizeClaim)\b/i);
  assert.ok(postAuth.includes('/^\\/\\?ref=[A-Z0-9]{10,32}$/.test(value)'));
  assert.match(verify, /safePostAuthPath/);
});

test("referral attachment is server-owned, self-safe, and idempotent", async () => {
  const [route, competition] = await Promise.all([
    read("app/api/referrals/attach/route.ts"),
    read("supabase/migrations/20260907000100_create_competition_foundation.sql"),
  ]);
  assert.match(route, /getVerifiedPlayerId/);
  assert.match(route, /Object\.keys\(body\)\.length !== 1/);
  assert.match(route, /normalizeReferralCode\(body\.code\)/);
  assert.match(route, /p_invitee_user_id: playerId/);
  assert.match(route, /p_code: code/);
  assert.match(route, /const playerId = await getVerifiedPlayerId\(\)/);
  assert.match(route, /isSameOrigin\(request\)/);
  assert.doesNotMatch(route, /body\.(?:userId|playerId|confirmed_share_count|weekly_share_results)/i);
  assert.match(competition, /if v_inviter_user_id = p_invitee_user_id then/);
  assert.match(competition, /Self referral is not permitted/);
  assert.match(competition, /invitee_user_id uuid not null unique/);
  assert.match(competition, /return v_existing\.id/);
  assert.match(competition, /security definer/);
  assert.match(competition, /set search_path = ''/);
});

test("Share rules state that it is optional and never awards competitive value", async () => {
  const [rules, terms] = await Promise.all([read("app/rules/page.tsx"), read("app/legal/terms/page.tsx")]);
  assert.match(rules, /Optional Social Sharing/);
  assert.match(rules, /does not create points, credits, ranking position, tournament eligibility, prizes, or payouts/);
  assert.match(terms, /Optional Social Sharing/);
  assert.match(terms, /does not create points, credits, ranking placement, tournament eligibility, prizes, or payouts/);
  assert.doesNotMatch(`${rules}\n${terms}`, /Weekly Share Challenge|\$10 Share pool|Top 10/i);
});
