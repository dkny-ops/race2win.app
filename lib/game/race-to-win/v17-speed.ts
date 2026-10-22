import type { RaceToWinConfig } from "./config";
/** v17: unchanged legacy speed through 80s, then multiplicative stages without a cap. */
export function v17SpeedAtSeconds(seconds: number, config: RaceToWinConfig): number {
  const oldSpeed = (at: number) => {
    const progress = Math.max(0, Math.min(at / config.speedRampSeconds, 1));
    const eased = 1 - (1 - progress) ** 2;
    const base = config.initialSpeedMps + (config.maxSpeedMps - config.initialSpeedMps) * eased;
    const steps = Math.min(config.maxSpeedIncreaseSteps, Math.floor(at / config.speedIncreaseIntervalSeconds));
    return Math.min(config.maxSpeedMps, base * config.speedIncreaseMultiplier ** steps);
  };
  if (seconds <= 80) return oldSpeed(seconds);
  const at80 = oldSpeed(80);
  const sixPercentSteps = Math.min(5, Math.floor((seconds - 80) / 20));
  const threePercentSteps = seconds >= 180 ? Math.floor((seconds - 180) / 30) : 0;
  return at80 * 1.06 ** sixPercentSteps * 1.03 ** threePercentSteps;
}
