/** Render-only input. No access to simulation methods or mutable game objects. */
export interface CoastalMotionFrame {
  readonly deltaSeconds: number;
  readonly distanceMeters: number;
  readonly speedKph: number;
  readonly running: boolean;
}

const TAU = Math.PI * 2;
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

/** Small bounded phases prevent precision loss, jumps and unbounded scrolling. */
export class CoastalMotion {
  public cloudPhase = 0;
  public windPhase = 0;
  public waterPhase = 0;
  public speed = 0;
  private previousDistance: number | null = null;

  public advance(frame: CoastalMotionFrame): void {
    const dt = Math.min(0.1, Math.max(0, finite(frame.deltaSeconds)));
    const distance = Math.max(0, finite(frame.distanceMeters));
    const deltaDistance = this.previousDistance === null ? 0 : distance - this.previousDistance;
    this.previousDistance = distance;
    // A stopped snapshot (pause, human check, ready or collision) cannot scroll.
    const moving = frame.running && deltaDistance > 0;
    const targetSpeed = moving ? Math.min(1, Math.max(0, finite(frame.speedKph) / 360)) : 0;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-dt * 3));
    this.cloudPhase = (this.cloudPhase + dt * 0.05) % TAU;
    this.windPhase = (this.windPhase + dt * (1.1 + this.speed * 0.2)) % TAU;
    this.waterPhase = (this.waterPhase + dt * 0.8) % TAU;
  }
}
