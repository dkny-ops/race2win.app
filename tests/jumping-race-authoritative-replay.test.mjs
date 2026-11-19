import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);

function load(relativePath, loadDependency) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const transpiledModule = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(loadDependency, transpiledModule, transpiledModule.exports);
  return transpiledModule.exports;
}

const engine = load("../lib/game/jumping-race/engine.ts", (name) => { throw new Error(`Unexpected engine dependency: ${name}`); });
const replay = load("../lib/game/jumping-race/authoritative-replay.ts", (name) => name === "./engine" ? engine : nodeRequire(name));

test("Jumping Race parser rejects forged score fields, repeated ticks and invalid directions", () => {
  assert.equal(replay.parseJumpingRaceActions([{ step: 0, direction: 1, jump: false, score: 999 }]), null);
  assert.equal(replay.parseJumpingRaceActions([{ step: 0, direction: 1, jump: false }, { step: 0, direction: 1, jump: false }]), null);
  assert.equal(replay.parseJumpingRaceActions([{ step: 0, direction: 2, jump: false }]), null);
});

test("Jumping Race replay is deterministic and rejects future input", () => {
  const actions = replay.parseJumpingRaceActions([{ step: 0, direction: 1, jump: false }]);
  assert.ok(actions);
  const first = replay.replayJumpingRace(actions, 10_000);
  const second = replay.replayJumpingRace(actions, 10_000);
  assert.deepEqual(first, second);
  assert.equal(replay.replayJumpingRace([{ step: 2_000, direction: 1, jump: false }], 1_000), null);
});

test("Jumping Race course seeds are deterministic per session and vary between sessions", () => {
  const first = engine.freshJumpingRace(101);
  const same = engine.freshJumpingRace(101);
  const different = engine.freshJumpingRace(202);
  assert.deepEqual(first.platforms, same.platforms);
  assert.notDeepEqual(first.platforms, different.platforms);
  assert.throws(() => engine.freshJumpingRace(-1));
});

test("Jumping Race flags only corroborated bot-like evidence for review", () => {
  const ordinary = Array.from({ length: 8 }, (_, step) => ({ step: step * 40, direction: 1, jump: false }));
  const replayResult = { score: 1, elapsedMs: 10_000, ended: true, reason: "fall", actionDigest: "test", telemetry: { jumps: 0, doubleJumps: 0, directionChanges: 0, platformsRemoved: 0 } };
  assert.deepEqual(replay.jumpingRaceReviewSignals(ordinary, replayResult), []);
  const dense = Array.from({ length: 180 }, (_, step) => ({ step, direction: step % 2 ? 1 : -1, jump: false }));
  const synthetic = { ...replayResult, elapsedMs: 5_000 };
  assert.deepEqual(replay.jumpingRaceReviewSignals(dense, synthetic), ["high_input_density", "uniform_action_cadence"]);
});

test("Jumping Race never accepts actions after a server-proven fall", () => {
  const valid = replay.replayJumpingRace([{ step: 0, direction: 1, jump: false }], 10_000);
  assert.ok(valid?.ended, "forward run should naturally fall within the authoritative window");
  const invalid = replay.replayJumpingRace([{ step: 0, direction: 1, jump: false }, { step: 1199, direction: 1, jump: true }], 10_000);
  assert.equal(invalid, null);
});


test("Jumping Race removes queued platforms every two seconds without changing the queue rules", () => {
  const state = engine.freshJumpingRace();
  state.started = true;
  state.furthestLanding = 2;
  state.nextRemovalAt = 0;
  const before = state.platforms.length;

  engine.stepJumpingRace(state, 0, false);

  assert.equal(engine.PLATFORM_LIFETIME, 2);
  assert.equal(state.platforms.length, before - 1);
  assert.equal(state.telemetry.platformsRemoved, 1);
  assert.ok(state.nextRemovalAt !== null);
  assert.ok(Math.abs((state.nextRemovalAt - state.time) - 2) < 1e-9);
});

test("Jumping Race uses the official four-to-one platform progression without shrinking active ledges", () => {
  const state = engine.freshJumpingRace();

  assert.equal(state.platforms[0].w, engine.TILE_SIZE * 4);
  assert.equal(engine.platformWidth(0), engine.TILE_SIZE * 4);
  assert.equal(engine.platformWidth(59.999), engine.TILE_SIZE * 4);
  assert.equal(engine.platformWidth(60), engine.TILE_SIZE * 3);
  assert.equal(engine.platformWidth(119.999), engine.TILE_SIZE * 3);
  assert.equal(engine.platformWidth(120), engine.TILE_SIZE * 2);
  assert.equal(engine.platformWidth(179.999), engine.TILE_SIZE * 2);
  assert.equal(engine.platformWidth(180), engine.TILE_SIZE);
  assert.equal(engine.platformWidth(600), engine.TILE_SIZE);

  state.started = true;
  state.time = 120 - engine.STEP / 2;
  const priorLedgeWidths = state.platforms.map((platform) => platform.w);
  engine.stepJumpingRace(state, 0, false);

  assert.deepEqual(state.platforms.map((platform) => platform.w), priorLedgeWidths);
});
