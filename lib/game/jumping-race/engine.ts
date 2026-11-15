export const WIDTH = 960;
export const HEIGHT = 540;
export const PLAYER_HEIGHT = 44;
export const STEP = 1 / 120;
export const PLATFORM_LIFETIME = 2;
const FLOOR = 460;
const GRAVITY = 1650;
const MOVE_SPEED = 380;
const colors = ["#21cafa", "#ae4bff", "#ff55c5", "#ffd344"];

type Platform = {
  x: number;
  y: number;
  w: number;
  touchedAt: number | null;
  color: string;
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
};

function platform(x: number, y: number, w: number, color: string): Platform {
  return { x, y, w, touchedAt: null, color };
}

function fillCourse(state: JumpingRaceState) {
  while (state.courseEnd < state.camera + WIDTH * 2) {
    const firstLedge = state.courseEnd + 190;
    const summit = firstLedge + 130;
    const nextFloor = summit + 145 + 480;
    state.platforms.push(
      platform(firstLedge, 380, 125, colors[1]),
      platform(firstLedge - 115, 225, 100, colors[2]),
      platform(summit, 150, 145, colors[3]),
      platform(nextFloor, FLOOR, 340, colors[0]),
    );
    state.courseEnd = nextFloor + 340;
  }
}

export function freshJumpingRace(): JumpingRaceState {
  const state: JumpingRaceState = {
    player: { x: 110, y: FLOOR - PLAYER_HEIGHT, vy: 0, jumps: 0 },
    platforms: [platform(0, FLOOR, 340, colors[0])],
    camera: 0,
    speed: 120,
    score: 0,
    time: 0,
    over: false,
    started: false,
    courseEnd: 340,
  };
  fillCourse(state);
  return state;
}

export function isPlatformActive(platform: Platform, time: number) {
  return platform.touchedAt === null || time < platform.touchedAt + PLATFORM_LIFETIME;
}

export function stepJumpingRace(state: JumpingRaceState, direction: -1 | 0 | 1, jump: boolean) {
  if (!state.started || state.over) return;
  state.time += STEP;
  state.speed = Math.min(155, 120 + state.time * 0.55);
  state.camera += state.speed * STEP;
  const player = state.player;
  if (jump && player.jumps < 2) {
    player.vy = player.jumps === 0 ? -530 : -690;
    player.jumps++;
  }

  const oldBottom = player.y + PLAYER_HEIGHT;
  const oldX = player.x;
  // Keep the runner within the visible right edge, without moving them with it.
  player.x = Math.min(player.x + direction * MOVE_SPEED * STEP, state.camera + WIDTH - 40);
  player.vy += GRAVITY * STEP;
  player.y += player.vy * STEP;
  const newBottom = player.y + PLAYER_HEIGHT;
  if (player.vy > 0 && newBottom > oldBottom) {
    let landing: Platform | undefined;
    for (const ledge of state.platforms) {
      if (!isPlatformActive(ledge, state.time) || oldBottom > ledge.y + 1e-6 || newBottom < ledge.y) continue;
      const fraction = Math.max(0, (ledge.y - oldBottom) / (newBottom - oldBottom));
      const crossingX = oldX + (player.x - oldX) * fraction;
      if (crossingX + 29 <= ledge.x || crossingX + 5 >= ledge.x + ledge.w) continue;
      if (!landing || ledge.y < landing.y) landing = ledge;
    }
    if (landing) {
      player.y = landing.y - PLAYER_HEIGHT;
      player.vy = 0;
      player.jumps = 0;
      landing.touchedAt ??= state.time;
    }
  }

  state.score = Math.max(state.score, Math.floor((player.x - 110) / 12));
  state.over = player.x + 29 <= state.camera || player.y > HEIGHT + 130;
  state.platforms = state.platforms.filter(ledge => ledge.x + ledge.w > state.camera - 50);
  fillCourse(state);
}

