import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("weekly scores remain independently available when the public leaderboard request fails", async () => {
  const scores = await read("components/scores/my-race-stats.tsx");
  assert.doesNotMatch(scores, /Promise\.all\(/);
  assert.match(scores, /setPersonalError\("Official weekly scores are temporarily unavailable/);
  assert.match(scores, /setLeaderboardError\("World players are temporarily unavailable/);
  assert.match(scores, /tab === "weekly" \? !personal/);
  assert.match(scores, /!leaderboard \? <p className="scores-message"/);
  assert.match(scores, /personal\?\.publicUsername === entry\.username/);
  assert.doesNotMatch(scores, /personal\?\.rank === entry\.rank/);
  assert.match(scores, /setLeaderboard\(null\)/);
  assert.match(scores, /const controller = new AbortController\(\)/);
  assert.doesNotMatch(scores, /validated_runs|weekly_tournament_totals|daily_top_scores|prize|ledger|payout/i);
});

test("public leaderboard records only an allowlisted failure stage", async () => {
  const [scores, route, events] = await Promise.all([
    read("lib/competition/scores.ts"),
    read("app/api/leaderboard/route.ts"),
    read("lib/observability/security-event.ts"),
  ]);
  assert.match(scores, /class LeaderboardReadError/);
  assert.match(scores, /new LeaderboardReadError\("game"\)/);
  assert.match(scores, /new LeaderboardReadError\("totals"\)/);
  assert.doesNotMatch(scores, /new LeaderboardReadError\("profiles"\)/);
  assert.match(route, /error instanceof LeaderboardReadError/);
  assert.doesNotMatch(route, /error\.message|JSON\.stringify\(error\)/);
  assert.match(events, /"leaderboard_game_unavailable"/);
  assert.match(events, /"leaderboard_totals_unavailable"/);
  assert.doesNotMatch(route, /leaderboard_profiles_unavailable/);
});

test("Back navigation uses only fixed internal destinations and preserves game context", async () => {
  const [scoresPage, scene, signIn, verify, backLink, gamePage] = await Promise.all([
    read("app/scores/page.tsx"),
    read("components/game/race-to-win/race-to-win-scene.tsx"),
    read("app/sign-in/page.tsx"),
    read("app/sign-in/verify/page.tsx"),
    read("components/navigation/back-link.tsx"),
    read("app/games/race-to-win/page.tsx"),
  ]);
  assert.match(scoresPage, /from === "play" \? ROUTES\.play : ROUTES\.home/);
  assert.match(scoresPage, /<BackLink href=\{backHref\}/);
  assert.match(scene, /href=\{`\$\{ROUTES\.scores\}\?from=play`\}/);
  assert.match(signIn, /<BackLink href=\{nextPath\}/);
  assert.match(verify, /<BackLink href=\{resendHref\}/);
  assert.match(backLink, /← BACK/);
  assert.doesNotMatch(backLink, /router\.|fetch\(|window\.history|javascript:/);
  assert.match(gamePage, /← BACK TO HOME/);
  assert.match(gamePage, /rtw-page-control/);
});

test("secondary static pages use the safe home Back destination", async () => {
  const pages = [
    "app/profile/page.tsx", "app/prizes/page.tsx", "app/leaderboard/page.tsx", "app/games/page.tsx",
    "app/how-it-works/page.tsx", "app/rules/page.tsx", "app/faq/page.tsx", "app/legal/terms/page.tsx",
    "app/legal/privacy/page.tsx",
  ];
  for (const page of pages) {
    const source = await read(page);
    assert.match(source, /<BackLink href=\{ROUTES\.home\}/, page);
  }
});
