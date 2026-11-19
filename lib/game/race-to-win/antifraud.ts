import type { LaneInputEvent } from "./types";

/**
 * Server-evaluated review signals. They are deliberately conservative: a
 * single weak pattern never rejects a run or changes player access.
 */
export function raceToWinReviewSignals(inputs: readonly LaneInputEvent[], elapsedMs: number): string[] {
  const signals: string[] = [];
  if (elapsedMs > 0 && inputs.length >= 80 && inputs.length / (elapsedMs / 1_000) > 8) signals.push("high_lane_change_density");
  if (inputs.length >= 40) {
    const gaps = inputs.slice(1).map((input, index) => input.atMs - inputs[index]!.atMs);
    const first = gaps[0];
    if (first !== undefined && first > 0 && gaps.every((gap) => gap === first)) signals.push("uniform_input_cadence");
  }
  return signals;
}

export function needsRaceToWinReview(signals: readonly string[]): boolean {
  return signals.includes("high_lane_change_density") && signals.includes("uniform_input_cadence");
}
