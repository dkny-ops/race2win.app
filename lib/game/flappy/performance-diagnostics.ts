export type FlappyPerformanceEvent = {
  kind: "frame" | "checkpoint" | "turnstile" | "visibility" | "focus";
  at: number;
  frameMs?: number;
  engineMs?: number;
  canvasMs?: number;
  durationMs?: number;
  state?: string;
};

const MAX_EVENTS = 240;

/**
 * Local, opt-in performance diagnostics. It never contains session IDs,
 * inputs, tokens, or player information and is disabled unless the developer
 * explicitly appends ?flappyDiagnostics=1.
 */
export class FlappyPerformanceDiagnostics {
  readonly enabled: boolean;
  private readonly events: FlappyPerformanceEvent[] = [];

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  record(event: Omit<FlappyPerformanceEvent, "at">): void {
    if (!this.enabled) return;
    this.events.push({ ...event, at: performance.now() });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  snapshot(): readonly FlappyPerformanceEvent[] {
    return this.events.slice();
  }
}

export function flappyDiagnosticsEnabled(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("flappyDiagnostics") === "1";
}
