import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/game/race-to-win/coastal-motion.ts", import.meta.url), "utf8");
const compiledModule = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(compiledModule, compiledModule.exports);
const { CoastalMotion } = compiledModule.exports;
const frame = (distanceMeters, deltaSeconds = 0.1, speedKph = 108, running = true) => Object.freeze({ distanceMeters, deltaSeconds, speedKph, running });

test("first snapshot and resets do not cause a burst of wind", () => {
  const motion = new CoastalMotion();
  motion.advance(frame(900));
  assert.equal(motion.speed, 0);
  motion.advance(frame(903));
  const speed = motion.speed, wind = motion.windPhase;
  assert.ok(speed > 0);
  motion.advance(frame(0, 0.1, 108, false));
  assert.ok(motion.speed < speed);
  assert.ok(motion.windPhase - wind < 0.2);
});

test("ambient timing and speed response agree at 10 and 60 frames per second", () => {
  const run = (fps) => {
    const motion = new CoastalMotion();
    motion.advance(frame(0, 0));
    for (let i = 1; i <= fps; i++) motion.advance(frame(i * 30 / fps, 1 / fps));
    return motion;
  };
  const slow = run(10), fast = run(60);
  assert.ok(Math.abs(slow.cloudPhase - fast.cloudPhase) < 1e-10);
  assert.ok(Math.abs(slow.waterPhase - fast.waterPhase) < 1e-10);
  assert.ok(Math.abs(slow.speed - fast.speed) < 1e-10);
});

test("pause, human-check snapshots and collisions reduce speed response while atmosphere continues", () => {
  const motion = new CoastalMotion();
  motion.advance(frame(0)); motion.advance(frame(3));
  const speed = motion.speed, wind = motion.windPhase;
  for (let i = 0; i < 10; i++) motion.advance(frame(3));
  motion.advance(frame(6, 0.1, 108, false));
  assert.ok(motion.speed < speed);
  assert.ok(motion.windPhase > wind);
});

test("faster motion gently increases breeze frequency without changing any input snapshot", () => {
  const slow = new CoastalMotion(), fast = new CoastalMotion();
  slow.advance(frame(0, 0)); fast.advance(frame(0, 0));
  const input = frame(10, 0.1, 360);
  fast.advance(input); slow.advance(frame(3));
  assert.ok(fast.windPhase > slow.windPhase);
  assert.ok(fast.speed > slow.speed);
  assert.deepEqual(input, frame(10, 0.1, 360));
});

test("a tab-resume delta or a distance discontinuity cannot produce a jump", () => {
  const motion = new CoastalMotion();
  motion.advance(frame(0, 0));
  motion.advance(frame(100000, 600, 108));
  assert.ok(motion.cloudPhase < 0.01);
  assert.ok(motion.windPhase < 0.2);
});

test("invalid display metrics never propagate NaN into shader phases", () => {
  const motion = new CoastalMotion();
  motion.advance(frame(NaN, Infinity, Infinity));
  motion.advance(frame(-100, -2, -100));
  for (const value of [motion.cloudPhase, motion.waterPhase, motion.windPhase, motion.speed]) assert.equal(value, 0);
});

test("long runs retain bounded phase values and constant state size", () => {
  const motion = new CoastalMotion();
  motion.advance(frame(0, 0));
  const keys = Object.keys(motion);
  for (let i = 1; i <= 100000; i++) motion.advance(frame(i * 10, 0.1, 360));
  for (const phase of [motion.cloudPhase, motion.waterPhase, motion.windPhase]) assert.ok(phase >= 0 && phase < Math.PI * 2);
  assert.deepEqual(Object.keys(motion), keys);
});
