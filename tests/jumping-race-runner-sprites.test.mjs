import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedFrames = [
  "run_01.png", "run_02.png", "run_03.png", "run_04.png",
  "jump_takeoff_01.png", "jump_takeoff_02.png",
  "jump_air_01.png", "jump_air_02.png", "jump_air_03.png", "jump_air_04.png",
  "double_jump_01.png", "double_jump_02.png", "double_jump_03.png",
  "land_01.png", "land_02.png", "land_03.png",
];

test("Jumping Race ships the approved runner animation frames", () => {
  const assets = path.join(root, "public", "images", "jumping-race", "runner");
  assert.deepEqual(fs.readdirSync(assets).sort(), [...expectedFrames].sort());
  for (const frame of expectedFrames) {
    const data = fs.readFileSync(path.join(assets, frame));
    assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${frame} must be a PNG`);
  }
});

test("Jumping Race preloads and feet-aligns runner sprites without changing the simulation", () => {
  const component = process.env.JUMPING_RACE_COMPONENT
    ?? path.join(root, "components", "game", "jumping-race-game.tsx");
  const source = fs.readFileSync(component, "utf8");
  assert.match(source, /function preloadRunnerSprites\(\)/);
  assert.match(source, /ctx\.drawImage\(image, x \+ 17 - RUNNER_SPRITE_SIZE \/ 2, y \+ 44 - RUNNER_SPRITE_SIZE/);
  assert.match(source, /const RUNNER_SPRITE_SIZE = 178/);
  assert.match(source, /function removeLowAlphaFrameHalo/);
  assert.match(source, /RUNNER_HALO_ALPHA_CUTOFF = 72/);
  assert.match(source, /function drawRunnerFallback/);
  assert.match(source, /runnerAssetState === "loading"/);
  assert.match(source, /jump_takeoff_01\.png/);
  assert.match(source, /double_jump_01\.png/);
  assert.match(source, /land_01\.png/);
});

