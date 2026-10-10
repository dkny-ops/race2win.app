import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("guest play is an in-memory recreation path and cannot initiate official persistence", async () => {
  const [link, game, scene, start, checkpoint, finalize] = await Promise.all([
    read("components/game/race-to-win/play-game-link.tsx"),
    read("components/game/race-to-win/race-to-win-game.tsx"),
    read("components/game/race-to-win/race-to-win-scene.tsx"),
    read("app/api/game-sessions/start/route.ts"),
    read("app/api/game-sessions/checkpoint/route.ts"),
    read("app/api/game-sessions/finalize/route.ts"),
  ]);
  assert.match(link, /href=\{ROUTES\.play\}/);
  assert.doesNotMatch(link, /getVerifiedUserContext/);
  assert.match(game, /officialMode=\{canStartOfficial\}/);
  assert.match(scene, /PLAY AS GUEST/);
  assert.match(game, /Guest scores are not saved/);
  const guestStart = scene.slice(scene.indexOf("const beginGuestRun"), scene.indexOf("const selectExtraLife"));
  assert.match(guestStart, /Guest play is deliberately local-only/);
  assert.match(guestStart, /simulation\.reset\(TRACK_SEED\)/);
  assert.doesNotMatch(guestStart, /fetch\(|officialSessionRef\.current = session|localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.match(scene, /if \(officialMode\) void finalizeOfficialRun\(\)/);
  assert.match(start, /if \(!userId\)/);
  assert.match(checkpoint, /if \(!playerId\)/);
  assert.match(finalize, /if \(!userId\)/);
});

test("guest UI has no Share, advertising, financial, or competitive authority", async () => {
  const [scene, referralAttach, referralCode, competitionMigration] = await Promise.all([
    read("components/game/race-to-win/race-to-win-scene.tsx"),
    read("app/api/referrals/attach/route.ts"),
    read("app/api/referrals/code/route.ts"),
    read("supabase/migrations/20260908000300_forward_competition_foundation_hardening.sql"),
  ]);
  assert.doesNotMatch(scene, /weekly_tournament_totals|daily_top_scores|validated_runs|prize_ledger|prize_balances|payout|referral|normal_ad|ad_reward/i);
  assert.match(referralAttach, /getVerifiedPlayerId\(\)/);
  assert.match(referralCode, /getVerifiedPlayerId\(\)/);
  assert.match(competitionMigration, /run\.completed_at >= v_referral\.attached_at/);
  assert.match(competitionMigration, /from public\.validated_runs/);
});

test("OTP policy update lowers only server-enforced per-email limits and the resend timer is non-authoritative UI", async () => {
  const [migration, requestRoute, signInPage, verifyPage, form, verifyForm] = await Promise.all([
    read("supabase/migrations/20261002220305_update_pre_auth_otp_email_limits.sql"),
    read("app/api/auth/request-code/route.ts"),
    read("app/sign-in/page.tsx"),
    read("app/sign-in/verify/page.tsx"),
    read("app/sign-in/sign-in-form.tsx"),
    read("app/sign-in/verify/verify-code-form.tsx"),
  ]);
  assert.match(migration, /'otp_request' and scope = 'email' then 1/);
  assert.match(migration, /'otp_verify' and scope = 'email' then 3/);
  assert.match(migration, /where \(action, scope\) in \(\('otp_request', 'email'\), \('otp_verify', 'email'\)\)/);
  assert.doesNotMatch(migration, /global_shard.*then [0-9]/);
  assert.match(requestRoute, /rtw_otp_request_available_at/);
  assert.match(requestRoute, /httpOnly: true/);
  assert.match(signInPage, /rtw_otp_request_available_at/);
  assert.match(verifyPage, /rtw_otp_request_available_at/);
  assert.match(form, /REQUEST ANOTHER CODE IN \$\{secondsRemaining\}s/);
  assert.match(verifyForm, /REQUEST ANOTHER CODE IN \{secondsRemaining\}s/);
  assert.match(verifyForm, /REQUEST ANOTHER CODE/);
  assert.match(form, /server-side PostgreSQL limiter remains authoritative/);
  assert.doesNotMatch(`${signInPage}\n${verifyPage}\n${form}\n${verifyForm}`, /localStorage|sessionStorage|indexedDB/);
});

test("Scores panel only displays server-generated Top 7 and leaderboard values", async () => {
  const [scores, scoresRoute, leaderboardRoute, scoreLibrary] = await Promise.all([
    read("components/scores/my-race-stats.tsx"),
    read("app/api/scores/me/route.ts"),
    read("app/api/leaderboard/route.ts"),
    read("lib/competition/scores.ts"),
  ]);
  assert.match(scores, /WEEKLY/);
  assert.match(scores, /WORLD PLAYERS/);
  assert.match(scores, /MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN/);
  assert.match(scores, /fetch\("\/api\/scores\/me"/);
  assert.match(scores, /fetch\(`\/api\/leaderboard\?page=\$\{worldPage\}&pageSize=50`/);
  assert.match(scores, /disabled=\{!leaderboard\.hasNextPage\}/);
  assert.match(scores, /personal\?\.publicUsername === entry\.username/);
  assert.match(scores, /No scores yet/);
  assert.doesNotMatch(scores, /validated_runs|daily_top_scores|weekly_tournament_totals|prize|ledger|payout/i);
  assert.match(scoresRoute, /getVerifiedPlayerId\(\)/);
  assert.match(leaderboardRoute, /readLeaderboard\(params\)/);
  assert.match(scoreLibrary, /timeZone: "America\/New_York"/);
  assert.match(scoreLibrary, /weekly_total_score, rank_position/);
  assert.match(scoreLibrary, /rpc\("rtw_read_public_leaderboard_page_metadata"/);
  assert.match(scoreLibrary, /hasNextPage: params\.page \* params\.pageSize < totalPublicEntries/);
  assert.doesNotMatch(scoreLibrary, /grant .* to (?:anon|authenticated)/i);
});
