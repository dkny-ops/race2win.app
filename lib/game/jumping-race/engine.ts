export const WIDTH = 960;
export const HEIGHT = 540;
export const PLAYER_HEIGHT = 44;
export const STEP = 1 / 120;
export const PLATFORM_LIFETIME = 2;
export const TILE_SIZE = 36;
const FULL_PLATFORM_WIDTH = 4 * TILE_SIZE;
const PLATFORM_WIDTH_STEP_SECONDS = 60;
const MIN_PLATFORM_BLOCKS = 1;
const FLOOR = 460;
const GRAVITY = 1650;
const MOVE_SPEED = 380;
const colors = ["#21cafa", "#ae4bff", "#ff55c5", "#ffd344"];

type Platform = {
  x: number;
  y: number;
  w: number;
  color: string;
  scored: boolean;
};

export type JumpingRaceState = {
  player: { x: number; y: number; vy: number; jumps: number };
  platforms: Platform[];
  camera: number;
  speed: number;
  score: number;
  time: number;
  over: boolean;
  started: boolean;
  courseEnd: number;
  cameraTarget: number;
  furthestLanding: number;
  nextRemovalAt: number | null;
  courseRng: number;
  telemetry: { jumps: number; doubleJumps: number; directionChanges: number; previousDirection: -1 | 0 | 1; platformsRemoved: number };
};

function platform(x: number, y: number, w: number, color: string): Platform {
  return { x, y, w, color, scored: false };
}

function courseRandom(state: JumpingRaceState): number {
  state.courseRng = (Math.imul(state.courseRng, 1664525) + 1013904223) >>> 0;
  return state.courseRng;
}

export function platformWidth(time: number) {
  // The starting floor is always a separate four-block platform. New ledges
  // narrow by one block every sixty seconds, but never become impassable.
  const blocks = Math.max(MIN_PLATFORM_BLOCKS, 4 - Math.floor(Math.max(0, time) / PLATFORM_WIDTH_STEP_SECONDS));
  return TILE_SIZE * blocks;
}

function fillCourse(state: JumpingRaceState) {
  while (state.courseEnd < state.camera + WIDTH * 2) {
    // Small, deterministic variations stop a public fixed route from being
    // precomputed while retaining the proven reachable course envelope.
    const lateral = ((courseRandom(state) % 5) - 2) * 10;
    const vertical = (((courseRandom(state) >>> 8) % 3) - 1) * 10;
    const firstLedge = state.courseEnd + 190 + lateral;
    const summit = firstLedge + FULL_PLATFORM_WIDTH + 5;
    const nextFloor = summit + FULL_PLATFORM_WIDTH + 450;
    const width = platformWidth(state.time);
    state.platforms.push(
      platform(firstLedge, 380 + vertical, width, colors[1]),
      platform(firstLedge - FULL_PLATFORM_WIDTH - 18, 225 + vertical, width, colors[2]),
      platform(summit, 150 + vertical, width, colors[3]),
      platform(nextFloor, FLOOR, width, colors[0]),
    );
    state.courseEnd = nextFloor + FULL_PLATFORM_WIDTH;
  }
}

export function freshJumpingRace(seed = 0): JumpingRaceState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Invalid course seed");
  const state: JumpingRaceState = {
    player: { x: 110, y: FLOOR - PLAYER_HEIGHT, vy: 0, jumps: 0 },
    platforms: [platform(0, FLOOR, FULL_PLATFORM_WIDTH, colors[0])],
    camera: 0,
    speed: 0,
    score: 0,
    time: 0,
    over: false,
    started: false,
    courseEnd: FULL_PLATFORM_WIDTH,
    cameraTarget: 0,
    furthestLanding: 0,
    nextRemovalAt: null,
    courseRng: seed >>> 0,
    telemetry: { jumps: 0, doubleJumps: 0, directionChanges: 0, previousDirection: 0, platformsRemoved: 0 },
  };
  fillCourse(state);
  return state;
}

function advancePlatformQueue(state: JumpingRaceState) {
  if (state.nextRemovalAt === null || state.time + 1e-9 < state.nextRemovalAt) return;

  state.platforms.splice(1, 1);
  state.telemetry.platformsRemoved++;
  state.furthestLanding--;
  state.nextRemovalAt = state.furthestLanding > 0 ? state.time + PLATFORM_LIFETIME : null;

  // Keep the next two ledges reachable, including the one behind a forward ledge.
  const nextLeft = Math.min(...state.platforms.slice(1, 3).map(ledge => ledge.x));
  if (Number.isFinite(nextLeft)) state.cameraTarget = Math.max(state.cameraTarget, nextLeft - 42);
}

export function stepJumpingRace(state: JumpingRaceState, direction: -1 | 0 | 1, jump: boolean) {
  if (!state.started || state.over) return;
  if (direction !== state.telemetry.previousDirection) {
    if (direction !== 0) state.telemetry.directionChanges++;
    state.telemetry.previousDirection = direction;
  }
  state.time += STEP;
  // Width changes apply only while adding a new ledge. Existing platforms,
  // especially the one carrying the player, never shrink beneath them.
  advancePlatformQueue(state);

  if (direction === 1) {
    const forward = state.player.x + MOVE_SPEED * STEP;
    const startScroll = Math.min(90, Math.max(0, (forward - 110) * 0.24));
    state.cameraTarget = Math.max(state.cameraTarget, startScroll, forward - 350);
  }
  const cameraTravel = Math.min(260 * STEP, state.cameraTarget - state.camera);
  state.speed = cameraTravel / STEP;
  state.camera += cameraTravel;
  const player = state.player;
  if (jump && player.jumps < 2) {
    player.vy = player.jumps === 0 ? -530 : -690;
    player.jumps++;
    state.telemetry.jumps++;
    if (player.jumps === 2) state.telemetry.doubleJumps++;
  }

  const oldBottom = player.y + PLAYER_HEIGHT;
  const oldX = player.x;
  // The left edge carries the runner forward instead of ending the run.
  player.x = Math.max(state.camera + 12, Math.min(
    player.x + direction * MOVE_SPEED * STEP,
    state.camera + WIDTH - 40,
  ));
  player.vy += GRAVITY * STEP;
  player.y += player.vy * STEP;
  const newBottom = player.y + PLAYER_HEIGHT;
  if (player.vy > 0 && newBottom > oldBottom) {
    let landingIndex = -1;
    for (const [index, ledge] of state.platforms.entries()) {
      if (oldBottom > ledge.y + 1e-6 || newBottom < ledge.y) continue;
      const fraction = Math.max(0, (ledge.y - oldBottom) / (newBottom - oldBottom));
      const crossingX = oldX + (player.x - oldX) * fraction;
      if (crossingX + 29 <= ledge.x || crossingX + 5 >= ledge.x + ledge.w) continue;
      if (landingIndex === -1 || ledge.y < state.platforms[landingIndex].y) landingIndex = index;
    }
    if (landingIndex !== -1) {
      const landing = state.platforms[landingIndex];
      player.y = landing.y - PLAYER_HEIGHT;
      if (!landing.scored) {
        landing.scored = true;
        state.score++;
      }
      player.vy = 0;
      player.jumps = 0;
      state.furthestLanding = Math.max(state.furthestLanding, landingIndex);
      if (state.furthestLanding > 0) state.nextRemovalAt ??= state.time + PLATFORM_LIFETIME;
    }
  }

  state.over = player.y > HEIGHT + 130;
  fillCourse(state);
}

