import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Race To Win state-changing official routes require an exact first-party Origin", async () => {
  for (const path of [
    "app/api/game-sessions/start/route.ts",
    "app/api/game-sessions/checkpoint/route.ts",
    "app/api/game-sessions/finalize/route.ts",
  ]) {
    const source = await read(path);
    assert.match(source, /!origin\s*\|\|\s*origin\s*!==\s*new URL\(request\.url\)\.origin/);
    assert.match(source, /sec-fetch-site"\)\s*===\s*"cross-site"/);
  }
});

test("Flappy Race refuses to create an official session if its human-verification gate is disabled", async () => {
  const source = await read("lib/game/flappy/server.ts");
  assert.match(source, /if \(gate\.error \|\| gate\.data !== true \|\| !getTurnstileWidgetConfiguration\("midrun_human_check"\)\)/);
  assert.match(source, /flappy_turnstile_enabled[\s\S]*flappy_consume_quota/);
  assert.match(source, /if \(!origin \|\| origin !== new URL\(request\.url\)\.origin/);
});

test("Jumping Race refuses checkpoints and finalization until session-bound human verification succeeds", async () => {
  for (const path of ["app/api/jumping-race/checkpoint/route.ts", "app/api/jumping-race/finalize/route.ts"]) {
    const source = await read(path);
    assert.match(source, /session\.verification_required !== true \|\| session\.verification_status !== "verified"/);
  }
});
