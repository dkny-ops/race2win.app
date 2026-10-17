import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("score surfaces use the shared neon row structure without replacing server data", async () => {
  const [personal, leaderboard, styles] = await Promise.all([
    readFile(new URL("components/scores/my-race-stats.tsx", root), "utf8"),
    readFile(new URL("components/scores/leaderboard-table.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(personal, /fetch\("\/api\/scores\/me"/);
  assert.match(personal, /scores-table--counting-runs/);
  assert.match(personal, /scores-table--run-history/);
  assert.match(personal, /scores-table__row--top-\$\{entry\.rank\}/);
  assert.match(leaderboard, /pageSize=50/);
  assert.match(leaderboard, /scores-table__row ranking-row/);
  assert.match(styles, /\.scores-page\{--score-neon:/);
  assert.match(styles, /\.scores-page \.scores-table__row--top-1/);
  assert.match(styles, /@media\(max-width:600px\)\{\.scores-page/);
  assert.doesNotMatch(`${personal}\n${leaderboard}`, /SpeedMaster|NitroBlaze|RoadKing/);
});
