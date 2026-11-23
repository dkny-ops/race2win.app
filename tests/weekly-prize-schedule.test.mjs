import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("all public winner tables use the same 5/3/2 weekly prize schedule", async () => {
  const [schedule, race, flappy, jumping] = await Promise.all([
    read("lib/competition/weekly-prizes.ts"),
    read("components/scores/leaderboard-table.tsx"),
    read("components/scores/flappy-ranking.tsx"),
    read("app/games/jumping-race/scores/page.tsx"),
  ]);
  assert.match(schedule, /\[0, 500, 300, 200\]/);
  for (const source of [race, flappy, jumping]) {
    assert.match(source, /weeklyPrizeLabelForRank/);
  }
});

test("Race To Win owner validation uses the shared 5/3/2 schedule", async () => {
  const source = await read("app/api/admin/validate-winner-balance/route.ts");
  assert.match(source, /weeklyPrizeCentsForRank/);
  assert.doesNotMatch(source, /1500/);
});
