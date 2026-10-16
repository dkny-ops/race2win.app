import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("guest score display is session-memory only and cannot become an official result", async () => {
  const [store, scene, scoresPage, guestStats] = await Promise.all([
    read("components/scores/guest-score-store.tsx"),
    read("components/game/race-to-win/race-to-win-scene.tsx"),
    read("app/scores/page.tsx"),
    read("components/scores/guest-race-stats.tsx"),
  ]);

  assert.match(store, /Deliberately memory-only/);
  const storeCode = store.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(storeCode, /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(/i);
  assert.match(scene, /Guest play is deliberately local-only/);
  assert.match(scene, /addGuestRun\(\{ score: outcome\.score/);
  assert.match(scene, /if \(officialMode\) void finalizeOfficialRun\(\);\s*else \{/);
  assert.match(scene, /if \(officialMode\) clearGuestRuns\(\);/);
  assert.match(scoresPage, /context \? <MyRaceStats \/> : <GuestRaceStats/);
  assert.doesNotMatch(guestStats, /\/api\/scores\/me|\/api\/(?:game-sessions|balances|prizes|payouts|referrals)|\.from\(|\.rpc\(|supabase/i);
});

test("guest weekly display matches the visual Top 7 model without claiming tournament eligibility", async () => {
  const guestStats = await read("components/scores/guest-race-stats.tsx");
  assert.match(guestStats, /\["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"\]/);
  assert.match(guestStats, /timeZone: "America\/New_York"/);
  assert.match(guestStats, /sort\(\(left, right\) => right\.score - left\.score/);
  assert.match(guestStats, /\.slice\(0, 7\)/);
  assert.match(guestStats, /weeklyTotal/);
  assert.match(guestStats, /scores-week-grid/);
  assert.match(guestStats, /scores-week-total/);
  assert.doesNotMatch(guestStats, /selectedDay|scores-days/);
  assert.match(guestStats, /WORLD POSITION[\s\S]*NOT ELIGIBLE/);
  assert.match(guestStats, /Signing in clears them; only new server-validated runs can qualify/);
  assert.match(guestStats, /fetch\(`\/api\/leaderboard\?page=\$\{worldPage\}&pageSize=50`/);
});

test("rules and terms disclose that browser-visible guest scores are not official proof", async () => {
  const [rules, terms] = await Promise.all([
    read("app/rules/page.tsx"),
    read("app/legal/terms/page.tsx"),
  ]);
  assert.match(rules, /Guest Scores/);
  assert.match(rules, /Registering does not convert any earlier guest score; official scoring starts at zero after sign-in/);
  assert.match(terms, /Closing or reloading the page removes them/);
  assert.match(terms, /Visual browser values are not proof of an official result/);
});
