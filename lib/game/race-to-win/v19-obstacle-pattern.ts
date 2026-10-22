import { MANUAL_OBSTACLE_PATTERN, MANUAL_TRACK_LENGTH } from "./manual-obstacle-pattern";

export const V19_TRACK_LENGTH = MANUAL_TRACK_LENGTH;
export const V19_OBSTACLE_PATTERN = Object.freeze(MANUAL_OBSTACLE_PATTERN.map((row) => row.z === -4235 && row.lane === 1 ? Object.freeze({ lane: row.lane, z: -4245 }) : row));
