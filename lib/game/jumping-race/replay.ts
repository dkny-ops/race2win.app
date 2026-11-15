import { freshJumpingRace, stepJumpingRace } from "./engine";

export const JUMPING_RULES_VERSION = "jumping-race-v1";
export const JUMPING_MAX_TICKS = 72_000;
export const JUMPING_MAX_INPUTS = 12_000;

type Direction = -1 | 0 | 1;
export type JumpingInput = Readonly<{
  tick: number;
  direction: Direction;
  jump: boolean;
}>;

export function parseJumpingInputs(value: unknown, throughTick: number): JumpingInput[] | null {
  if (!Number.isSafeInteger(throughTick) || throughTick < 1 || throughTick > JUMPING_MAX_TICKS ||
      !Array.isArray(value) || value.length > JUMPING_MAX_INPUTS) return null;
  const inputs: JumpingInput[] = [];
  let lastTick = -1;
  let lastDirection: Direction = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).length !== 3) return null;
    const { tick, direction, jump } = entry as Record<string, unknown>;
    if (typeof tick !== "number" || !Number.isSafeInteger(tick) || tick <= lastTick || tick >= throughTick ||
        (direction !== -1 && direction !== 0 && direction !== 1) || typeof jump !== "boolean" ||
        (!jump && direction === lastDirection)) return null;
    lastTick = tick;
    lastDirection = direction;
    inputs.push({ tick, direction, jump });
  }
  return inputs;
}

export function replayJumpingRace(version: string, evidence: unknown, throughTick: number) {
  if (version !== JUMPING_RULES_VERSION) return null;
  const inputs = parseJumpingInputs(evidence, throughTick);
  if (!inputs) return null;

  const state = freshJumpingRace();
  state.started = true;
  let direction: Direction = 0;
  let index = 0;
  for (let tick = 0; tick < throughTick; tick++) {
    if (state.over) return null;
    const input = inputs[index]?.tick === tick ? inputs[index++] : undefined;
    if (input) direction = input.direction;
    stepJumpingRace(state, direction, input?.jump ?? false);
  }

  return {
    throughTick,
    terminal: state.over,
    score: state.score,
    telemetry: {
      jumps: state.telemetry.jumps,
      doubleJumps: state.telemetry.doubleJumps,
      directionChanges: state.telemetry.directionChanges,
      platformsRemoved: state.telemetry.platformsRemoved,
    },
  };
}

