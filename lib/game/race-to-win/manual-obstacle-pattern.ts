/** v15 fixed manual lane order, spaced by 40m (single) / 45m (double).
 * The first row stays at 50m; rows repeat only until the v14 60-second
 * distance cutoff. Old sessions replay against their archived version.
 */
export const MANUAL_TRACK_LENGTH = 50_000;
export const MANUAL_ONE_MINUTE_DISTANCE_METERS = 4277.291085391142;
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
const rows: Array<Readonly<{ lane: 0 | 1 | 2; z: number }>> = [];
let distance = 50;
let index = 0;
while (distance <= MANUAL_ONE_MINUTE_DISTANCE_METERS) {
  const lanes = BASE_ROW_LANES[index % BASE_ROW_LANES.length]!;
  for (const lane of lanes) rows.push(Object.freeze({ lane, z: -distance }));
  index += 1;
  const nextLanes = BASE_ROW_LANES[index % BASE_ROW_LANES.length]!;
  distance += nextLanes.length === 2 ? 45 : 40;
}
export const MANUAL_OBSTACLE_PATTERN: ReadonlyArray<Readonly<{ lane: 0 | 1 | 2; z: number }>> = Object.freeze(rows);
