import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedFrames = [
  "idle_01.png",
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
  assert.match(source, /function runnerFeetBaseline/);
  assert.match(source, /const runnerFeetBaselines = new Map/);
  assert.match(source, /y \+ 44 - renderedFeet/);
  assert.match(source, /runner\/idle_01\.png/);
  assert.match(source, /ctx\.scale\(-1, 1\)/);
  assert.match(source, /const RUNNER_SPRITE_SIZE = 120/);
  assert.match(source, /function removeLowAlphaFrameHalo/);
  assert.match(source, /RUNNER_HALO_ALPHA_CUTOFF = 72/);
  assert.match(source, /function drawRunnerFallback/);
  assert.match(source, /runnerAssetState === "loading"/);
  assert.match(source, /jump_takeoff_01\.png/);
  assert.match(source, /double_jump_01\.png/);
  assert.match(source, /land_01\.png/);
});

test("Jumping Race ships four transparent platform variants and maps each physical width to its own art", async () => {
  const platforms = [1, 2, 3, 4];
  for (const spaces of platforms) {
    const asset = path.join(root, "public", "images", "jumping-race", `platform-${spaces}.png`);
    const { data, info } = await sharp(asset).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    assert.equal(alphaAt(0, 0), 0, `${spaces}-space art must have a transparent background`);
    assert.equal(alphaAt(info.width - 1, info.height - 1), 0, `${spaces}-space art must have a transparent background`);
  }

  const component = fs.readFileSync(path.join(root, "components", "game", "jumping-race-game.tsx"), "utf8");
  assert.match(component, /platform-1\.png/);
  assert.match(component, /platform-2\.png/);
  assert.match(component, /platform-3\.png/);
  assert.match(component, /platform-4\.png/);
  assert.match(component, /const spaces = Math\.max\(1, Math\.min\(4, Math\.round\(width \/ TILE_SIZE\)\)\)/);
  assert.match(component, /const height = width \* \(image\.naturalHeight \/ image\.naturalWidth\)/);
});

