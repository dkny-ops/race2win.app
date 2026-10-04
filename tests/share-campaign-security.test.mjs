import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Share Top 10 has a narrow service-only server projection", async () => {
  const [migration, shares] = await Promise.all([
    read("supabase/migrations/20261004000200_read_weekly_share_leaderboard.sql"),
    read("lib/competition/shares.ts"),
  ]);
  assert.match(migration, /returns table\s*\(\s*rank_position integer,\s*username text,\s*confirmed_share_count integer/s);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /owner to postgres/);
  assert.match(migration, /p_limit > 10/);
  assert.match(migration, /revoke all on function public\.rtw_read_weekly_share_leaderboard\(uuid, date, integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rtw_read_weekly_share_leaderboard\(uuid, date, integer\) to service_role/);
  assert.doesNotMatch(migration, /select \*|paypal|email|payout|ledger|prize_balances/i);
  assert.match(shares, /rpc\("rtw_read_weekly_share_leaderboard"/);
  assert.match(shares, /p_limit: 10/);
  assert.doesNotMatch(shares, /fetch\(|from\("profiles"\)|from\("referrals"\)|from\("validated_runs"\)/i);
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
  assert.match(campaign, /3 server-validated official runs on 5 different New York days/);
  assert.match(campaign, /fixed \$10 pool is split by the server/);
  assert.match(campaign, /JSON\.stringify\(\{ code: referralCode \}\)/);
  assert.doesNotMatch(campaign, /JSON\.stringify\(\{[^}]*\b(?:userId|playerId|score|balance|payout|prizeClaim)\b/i);
  assert.ok(postAuth.includes('/^\\/\\?ref=[A-Z0-9]{10,32}$/.test(value)'));
  assert.match(verify, /safePostAuthPath/);
});

test("Share rules explain that clicks and guest or altered browser state do not count", async () => {
  const [rules, terms] = await Promise.all([read("app/rules/page.tsx"), read("app/legal/terms/page.tsx")]);
  assert.match(rules, /Weekly Share Challenge/);
  assert.match(rules, /3 server-validated official runs on 5 distinct New York days/);
  assert.match(rules, /A click, guest run, altered browser value, or unvalidated run never counts/);
  assert.match(rules, /tied highest confirmed counts split the pool/);
  assert.match(terms, /Weekly Share Challenge/);
  assert.match(terms, /not a promise of a prize/);
});
