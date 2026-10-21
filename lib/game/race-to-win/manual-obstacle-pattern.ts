/** Exactly 21 stationary obstacles, manually placed in three repetitions.
 * Distances are measured from the player's start. No obstacles after 330m.
 * lane 0=left, 1=center, 2=right. Shared z values make two-car rows.
 * Versioned v11 authoritative pattern: edit only with a new gameplay version.
 */
export const MANUAL_TRACK_LENGTH = 50_000;
export const MANUAL_OBSTACLE_PATTERN: ReadonlyArray<Readonly<{ lane: 0 | 1 | 2; z: number }>> = [
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
];
