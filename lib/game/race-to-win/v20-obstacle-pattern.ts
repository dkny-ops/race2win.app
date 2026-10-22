import { V19_OBSTACLE_PATTERN, V19_TRACK_LENGTH } from "./v19-obstacle-pattern";

/** Preserve v19 replay. From 4,320m onward add 20m, then add 20m
 * at each subsequent two-lane obstacle row, shifting all following rows.
 * Use original row distances to group doubles and preserve lane alignment.
 */
const START = 4320;
let cumulativeOffset = 0;
let previousDistance = Number.NaN;
let rowCount = 0;
const adjusted = V19_OBSTACLE_PATTERN.map((row) => {
  const distance = -row.z;
  if (distance !== previousDistance) {
    previousDistance = distance;
    rowCount = 0;
  }
  rowCount += 1;
  return { row, distance };
});
const doubleDistances = new Set<number>();
for (let i = 0; i < adjusted.length; i += 1) {
  const current = adjusted[i]!;
  if (current.distance >= START && i + 1 < adjusted.length && adjusted[i + 1]!.distance === current.distance) {
    doubleDistances.add(current.distance);
  }
}
let lastDistance = Number.NaN;
export const V20_OBSTACLE_PATTERN = Object.freeze(adjusted.map(({ row, distance }) => {
  if (distance >= START && distance !== lastDistance) {
    if (cumulativeOffset === 0) cumulativeOffset = 20;
    if (doubleDistances.has(distance)) cumulativeOffset += 20;
  }
  lastDistance = distance;
  return Object.freeze({ lane: row.lane, z: row.z - (distance >= START ? cumulativeOffset : 0) });
}));
export const V20_TRACK_LENGTH = V19_TRACK_LENGTH + cumulativeOffset;
