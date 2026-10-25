// flappy-v1: integer hundredths of a pixel; one fixed step = 1/60 second.
export const FLAPPY_VERSION = "flappy-v1";
export const MAX_TICKS = 36_000;
export const MAX_INPUTS = 6_000;
export const MIN_FLAP_TICKS = 4;
export type Pipe = { x: number; gap: number; passed: boolean };
export type FlappyState = { tick: number; y: number; vy: number; pipes: Pipe[]; score: number; dead: boolean; rng: number };
export function initialFlappy(seed: number): FlappyState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Invalid seed");
  return { tick: 0, y: 22000, vy: 0, pipes: [], score: 0, dead: false, rng: seed >>> 0 };
}
function random(s: FlappyState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng;
}
export function stepFlappy(s: FlappyState, flap: boolean): void {
  if (s.dead || s.tick >= MAX_TICKS) return;
  if (flap) s.vy = -550;
  s.vy += 29;
  s.y += s.vy;
  if (s.tick + 1 > 95 && (!s.pipes.length || s.pipes[s.pipes.length - 1].x < 18500)) {
    s.pipes.push({ x: 36500, gap: 10500 + random(s) % 20501, passed: false });
  }
  for (const p of s.pipes) {
    p.x -= 215;
    if (!p.passed && p.x + 5400 < 8200) { p.passed = true; s.score++; }
    if (9500 > p.x && 6900 < p.x + 5400 && (s.y - 1300 < p.gap - 7500 || s.y + 1300 > p.gap + 7500)) s.dead = true;
  }
  s.pipes = s.pipes.filter(p => p.x > -5400);
  if (s.y < 1300 || s.y > 44400) s.dead = true;
  s.tick++;
}
export function parseFlaps(value: unknown, throughTick: number): number[] | null {
  if (!Number.isSafeInteger(throughTick) || throughTick < 1 || throughTick > MAX_TICKS ||
      !Array.isArray(value) || value.length > MAX_INPUTS) return null;
  let previous = -MIN_FLAP_TICKS;
  for (const tick of value) {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick >= throughTick || tick - previous < MIN_FLAP_TICKS) return null;
    previous = tick;
  }
  return value as number[];
}
export function replayFlappy(seed: number, inputs: number[], throughTick: number): FlappyState | null {
  if (!parseFlaps(inputs, throughTick)) return null;
  const s = initialFlappy(seed);
  let index = 0;
  while (s.tick < throughTick && !s.dead) {
    const flap = inputs[index] === s.tick;
    if (flap) index++;
    stepFlappy(s, flap);
  }
  // Evidence after a collision is not a legitimate continuation.
  return index === inputs.length ? s : null;
}
