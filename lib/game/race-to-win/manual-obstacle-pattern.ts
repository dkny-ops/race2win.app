/** v14: repeat the approved 48-car layout until the distance reached at 60s.
 * The 60-second cutoff (4277.291m) is derived from the versioned v14 speed
 * curve at 60Hz. No new obstacles appear beyond this distance.
 * The base 48-car pattern is preserved in legacy-v13-obstacle-pattern.ts.
 */
export const MANUAL_TRACK_LENGTH = 50_000;
export const MANUAL_ONE_MINUTE_DISTANCE_METERS = 4277.291085391142;
const BASE_PATTERN: ReadonlyArray<Readonly<{ lane: 0 | 1 | 2; z: number }>> = [
  { lane: 1, z: -50 },
  { lane: 0, z: -70 },
  { lane: 2, z: -70 },
  { lane: 1, z: -90 },
  { lane: 1, z: -110 },
  { lane: 0, z: -130 },
  { lane: 2, z: -130 },
  { lane: 1, z: -150 },
  { lane: 0, z: -170 },
  { lane: 2, z: -170 },
  { lane: 1, z: -190 },
  { lane: 1, z: -210 },
  { lane: 0, z: -230 },
  { lane: 2, z: -230 },
  { lane: 1, z: -250 },
  { lane: 0, z: -270 },
  { lane: 2, z: -270 },
  { lane: 1, z: -290 },
  { lane: 1, z: -310 },
  { lane: 0, z: -330 },
  { lane: 2, z: -330 },
  { lane: 0, z: -350 },
  { lane: 1, z: -350 },
  { lane: 1, z: -375 },
  { lane: 2, z: -375 },
  { lane: 0, z: -395 },
  { lane: 2, z: -395 },
  { lane: 1, z: -415 },
  { lane: 0, z: -435 },
  { lane: 2, z: -435 },
  { lane: 1, z: -455 },
  { lane: 1, z: -475 },
  { lane: 0, z: -495 },
  { lane: 2, z: -495 },
  { lane: 1, z: -515 },
  { lane: 0, z: -535 },
  { lane: 2, z: -535 },
  { lane: 1, z: -555 },
  { lane: 1, z: -575 },
  { lane: 0, z: -595 },
  { lane: 2, z: -595 },
  { lane: 1, z: -615 },
  { lane: 0, z: -635 },
  { lane: 2, z: -635 },
  { lane: 1, z: -655 },
  { lane: 1, z: -675 },
  { lane: 0, z: -695 },
  { lane: 2, z: -695 },
];
const REPEAT_DISTANCE_METERS = 665; // next first car at 715m, 20m after last at 695m
export const MANUAL_OBSTACLE_PATTERN: ReadonlyArray<Readonly<{ lane: 0 | 1 | 2; z: number }>> = Object.freeze(
  Array.from({ length: Math.ceil(MANUAL_ONE_MINUTE_DISTANCE_METERS / REPEAT_DISTANCE_METERS) })
    .flatMap((_, cycle) => BASE_PATTERN.map((entry) => Object.freeze({
      lane: entry.lane,
      z: entry.z - cycle * REPEAT_DISTANCE_METERS,
    })))
    .filter((entry) => -entry.z <= MANUAL_ONE_MINUTE_DISTANCE_METERS),
);
