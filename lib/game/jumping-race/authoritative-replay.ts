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
 * These are review signals, never an automatic ban. A deterministic replay is
 * evidence of physical validity, not proof that a person supplied the inputs.
 */
export function jumpingRaceReviewSignals(actions: readonly JumpingRaceAction[], replay: JumpingRaceReplay): string[] {
  const signals: string[] = [];
  if (actions.length >= 180 && replay.elapsedMs > 0 && actions.length / (replay.elapsedMs / 1_000) > 24) signals.push("high_input_density");
  if (actions.length >= 40) {
    const gaps = actions.slice(1).map((action, index) => action.step - actions[index]!.step);
    const first = gaps[0];
    if (first !== undefined && gaps.every((gap) => gap === first)) signals.push("uniform_action_cadence");
  }
  return signals;
}

/**
 * Replays only server-bounded ticks. The client supplies actions, never elapsed
 * time, score, position, platform layout or a random seed: the course is fixed
 * by the approved v1 validator.
 */
export function replayJumpingRace(actions: readonly JumpingRaceAction[], serverElapsedMs: number, courseSeed = 0): JumpingRaceReplay | null {
  if (!Number.isSafeInteger(serverElapsedMs) || serverElapsedMs < 0) return null;
  if (actions.length > MAX_JUMPING_RACE_ACTIONS) return null;
  const maxSteps = Math.min(MAX_JUMPING_RACE_STEPS, Math.floor(serverElapsedMs / (STEP * 1000)));
  const state = freshJumpingRace(courseSeed);
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

