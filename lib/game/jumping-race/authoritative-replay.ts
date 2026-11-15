import { createHash } from "node:crypto";
import { freshJumpingRace, STEP, stepJumpingRace } from "./engine";

export const JUMPING_RACE_GAMEPLAY_VERSION = "jumping-race-v1";
export const MAX_JUMPING_RACE_ACTIONS = 12_000;
export const MAX_JUMPING_RACE_STEPS = 86_400; // Twelve minutes at 120Hz.

export type JumpingRaceAction = Readonly<{ step: number; direction: -1 | 0 | 1; jump: boolean }>;
export type JumpingRaceReplay = Readonly<{
  score: number;
  elapsedMs: number;
  ended: boolean;
  reason: "fall" | "time_limit";
  actionDigest: string;
  telemetry: Readonly<{ jumps: number; doubleJumps: number; directionChanges: number; platformsRemoved: number }>;
}>;

function isAction(value: unknown): value is JumpingRaceAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  return Object.keys(action).length === 3
    && Number.isSafeInteger(action.step) && (action.step as number) >= 0
    && ((action.direction as number) === -1 || action.direction === 0 || action.direction === 1)
    && typeof action.jump === "boolean";
}

/** Strict parse: no hidden fields, no fractional ticks and no client supplied score. */
export function parseJumpingRaceActions(value: unknown): JumpingRaceAction[] | null {
  if (!Array.isArray(value) || value.length > MAX_JUMPING_RACE_ACTIONS) return null;
  const actions: JumpingRaceAction[] = [];
  let previous = -1;
  for (const raw of value) {
    if (!isAction(raw) || raw.step <= previous) return null;
    previous = raw.step;
    actions.push({ step: raw.step, direction: raw.direction, jump: raw.jump });
  }
  return actions;
}

export function digestJumpingRaceActions(actions: readonly JumpingRaceAction[]): string {
  return createHash("sha256").update(JSON.stringify(actions)).digest("hex");
}

/**
 * Replays only server-bounded ticks. The client supplies actions, never elapsed
 * time, score, position, platform layout or a random seed: the course is fixed
 * by the approved v1 validator.
 */
export function replayJumpingRace(actions: readonly JumpingRaceAction[], serverElapsedMs: number): JumpingRaceReplay | null {
  if (!Number.isSafeInteger(serverElapsedMs) || serverElapsedMs < 0) return null;
  if (actions.length > MAX_JUMPING_RACE_ACTIONS) return null;
  const maxSteps = Math.min(MAX_JUMPING_RACE_STEPS, Math.floor(serverElapsedMs / (STEP * 1000)));
  const state = freshJumpingRace();
  state.started = true;
  let nextAction = 0;
  let direction: -1 | 0 | 1 = 0;
  for (let step = 0; step < maxSteps; step++) {
    let jump = false;
    while (nextAction < actions.length && actions[nextAction]!.step === step) {
      const action = actions[nextAction]!;
      if (!isAction(action)) return null;
      direction = action.direction;
      jump ||= action.jump;
      nextAction++;
    }
    // An event can never be projected into a future server tick.
    if (nextAction < actions.length && actions[nextAction]!.step < step) return null;
    stepJumpingRace(state, direction, jump);
    if (state.over) {
      // Any remaining action was submitted after a server-proven fall.
      if (nextAction < actions.length) return null;
      return {
        score: state.score, elapsedMs: Math.round((step + 1) * STEP * 1000), ended: true, reason: "fall",
        actionDigest: digestJumpingRaceActions(actions),
        telemetry: { jumps: state.telemetry.jumps, doubleJumps: state.telemetry.doubleJumps, directionChanges: state.telemetry.directionChanges, platformsRemoved: state.telemetry.platformsRemoved },
      };
    }
  }
  // A run that has not naturally ended is not finalizable; it is only a
  // checkpoint candidate. Actions beyond the elapsed server window are invalid.
  if (nextAction < actions.length || (actions.at(-1)?.step ?? -1) >= maxSteps) return null;
  return {
    score: state.score, elapsedMs: Math.round(maxSteps * STEP * 1000), ended: false, reason: "time_limit",
    actionDigest: digestJumpingRaceActions(actions),
    telemetry: { jumps: state.telemetry.jumps, doubleJumps: state.telemetry.doubleJumps, directionChanges: state.telemetry.directionChanges, platformsRemoved: state.telemetry.platformsRemoved },
  };
}

---RTW_SPLIT---
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

test("Jumping Race never accepts actions after a server-proven fall", () => {
  const valid = replay.replayJumpingRace([{ step: 0, direction: 1, jump: false }], 10_000);
  assert.ok(valid?.ended, "forward run should naturally fall within the authoritative window");
  const invalid = replay.replayJumpingRace([{ step: 0, direction: 1, jump: false }, { step: 1199, direction: 1, jump: true }], 10_000);
  assert.equal(invalid, null);
});

