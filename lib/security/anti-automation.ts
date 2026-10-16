/**
 * Privacy-bounded, non-authoritative control telemetry.  Every field in this
 * shape originates in the browser and may be forged or omitted. It can add a
 * review signal; it can never make a run valid or grant an eligibility state.
 */
export type ControlTelemetry = Readonly<{
  version: 1;
  keyboardEvents: number;
  touchEvents: number;
  pointerEvents: number;
  trustedEvents: number;
  untrustedEvents: number;
  webdriverReported: boolean;
}>;

export type AntiAutomationAssessment = Readonly<{
  status: "verified" | "review_required";
  /** Allowlisted categories only: no raw browser data, identifiers, or input timings are retained. */
  signals: readonly ("uniform_input_cadence" | "webdriver_reported" | "untrusted_input_events")[];
}>;

const MAX_TELEMETRY_COUNT = 10_000;

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TELEMETRY_COUNT ? value : null;
}

/** Strictly parses the small allowlist. Extra browser properties are discarded. */
export function parseControlTelemetry(value: unknown): ControlTelemetry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keyboardEvents = count(body.keyboardEvents);
  const touchEvents = count(body.touchEvents);
  const pointerEvents = count(body.pointerEvents);
  const trustedEvents = count(body.trustedEvents);
  const untrustedEvents = count(body.untrustedEvents);
  if (
    body.version !== 1 || keyboardEvents === null || touchEvents === null || pointerEvents === null
    || trustedEvents === null || untrustedEvents === null || typeof body.webdriverReported !== "boolean"
  ) return null;
  return { version: 1, keyboardEvents, touchEvents, pointerEvents, trustedEvents, untrustedEvents, webdriverReported: body.webdriverReported };
}

function uniformCadence(inputTimes: readonly number[]): boolean {
  if (inputTimes.length < 12) return false;
  const intervals = inputTimes.slice(1).map((at, index) => at - inputTimes[index]!);
  return intervals.every((interval) => Number.isSafeInteger(interval) && interval > 0 && interval === intervals[0]);
}

/**
 * A valid replay is still valid regardless of this result.  Only a conjunction
 * of weak, independently sourced signals requests human review.  In
 * particular, keyboard, touch, accessibility tooling, high scores, no moves,
 * a single browser flag, or a repeated route alone never reject a player.
 */
export function assessAntiAutomationRisk(inputTimes: readonly number[], telemetry: ControlTelemetry | null): AntiAutomationAssessment {
  const signals: AntiAutomationAssessment["signals"][number][] = [];
  const cadence = uniformCadence(inputTimes);
  if (cadence) signals.push("uniform_input_cadence");
  if (telemetry?.webdriverReported === true) signals.push("webdriver_reported");
  if (telemetry && telemetry.untrustedEvents > 0 && telemetry.trustedEvents === 0) signals.push("untrusted_input_events");

  // Browser telemetry is forgeable, and uniform controls can be human.  It is
  // therefore useful only as corroboration for a manual-review queue.
  const corroborated = cadence && telemetry?.webdriverReported === true
    && telemetry.untrustedEvents > 0 && telemetry.trustedEvents === 0;
  return { status: corroborated ? "review_required" : "verified", signals };
}
