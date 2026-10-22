import { DEFAULT_RACE_TO_WIN_CONFIG } from "./config";
import { v17SpeedAtSeconds } from "./v17-speed";
/** v17: retain v15's first minute, append the four requested rows,
 * then repeat the entire sequence until 600 seconds of the versioned speed curve.
 * The 45m opposite-lane doubles are deliberately not silently removed.
 */
export const MANUAL_TRACK_LENGTH = 50_000;
const FIRST_MINUTE_METERS = 4277.291085391142;
const BASE_ROW_LANES: ReadonlyArray<readonly (0 | 1 | 2)[]> = [
  [1],
  [0, 2],
  [1],
  [1],
  [0, 2],
  [1],
  [0, 2],
  [1],
  [1],
  [0, 2],
  [1],
  [0, 2],
  [1],
  [1],
  [0, 2],
  [0, 1],
  [1, 2],
  [0, 2],
  [1],
  [0, 2],
  [1],
  [1],
  [0, 2],
  [1],
  [0, 2],
  [1],
  [1],
  [0, 2],
  [1],
  [0, 2],
  [1],
  [1],
  [0, 2],
];

type Row = Readonly<{ lane: 0 | 1 | 2; z: number }>;
const firstMinute: Array<{ distance: number; lanes: readonly (0 | 1 | 2)[] }> = [];
let distance = 50;
let index = 0;
while (distance <= FIRST_MINUTE_METERS) {
  const lanes = BASE_ROW_LANES[index % BASE_ROW_LANES.length]!;
  firstMinute.push({ distance, lanes });
  index += 1;
  distance += BASE_ROW_LANES[index % BASE_ROW_LANES.length]!.length === 2 ? 45 : 40;
}
const last = firstMinute[firstMinute.length - 1]!.distance;
const sequence = [
  ...firstMinute,
  { distance: last + 45, lanes: [1, 2] as const }, // center + right
  { distance: last + 90, lanes: [0, 1] as const }, // left + center
  { distance: last + 130, lanes: [1] as const }, // center
  { distance: last + 170, lanes: [1] as const }, // center
];
const cycleLength = last + 170; // restart at the same initial 50m offset
// Integrate the authoritative 60Hz speed curve through exactly three minutes.
const fixedStepSeconds = 1 / 60;
let totalDistance = 0;
for (let tick = 1; tick <= 600 * 60; tick += 1) {
  const elapsed = tick * fixedStepSeconds;
  totalDistance += v17SpeedAtSeconds(elapsed, DEFAULT_RACE_TO_WIN_CONFIG) * fixedStepSeconds;
}
export const MANUAL_TEN_MINUTE_DISTANCE_METERS = totalDistance;
const pattern: Row[] = [];
for (let cycle = 0; cycle * cycleLength <= totalDistance; cycle += 1) {
  for (const row of sequence) {
    const at = row.distance + cycle * cycleLength;
    if (at > totalDistance) break;
    for (const lane of row.lanes) pattern.push(Object.freeze({ lane, z: -at }));
  }
}
export const MANUAL_OBSTACLE_PATTERN: ReadonlyArray<Row> = Object.freeze(pattern);
