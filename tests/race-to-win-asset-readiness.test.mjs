import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const world = readFileSync(new URL("../lib/game/race-to-win/world.ts", import.meta.url), "utf8");
const scene = readFileSync(new URL("../components/game/race-to-win/race-to-win-scene.tsx", import.meta.url), "utf8");

test("Race To Win waits for defined essential visual readiness before PLAY", () => {
  assert.match(world, /private readonly essentialAssetsReady: Promise<void>;/);
  assert.match(world, /this\.essentialAssetsReady = this\.loadOwnedVehicleAssets\(\)\.catch/);
  assert.match(world, /public waitForEssentialAssets\(\): Promise<void>/);
  assert.match(scene, /world\.waitForEssentialAssets\(\)\.then/);
  assert.match(scene, /if \(worldRef\.current !== world\) return/);
  assert.doesNotMatch(scene, /world\.assetsReady/);
});
