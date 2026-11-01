export type FlappyCheck = {
  required: boolean; serverNow: string; nextDueAt?: string; due?: boolean; nonce?: string | null;
};
export type FlappyCheckConfiguration = FlappyCheck & { siteKey: string };
type Transport = (body: { sessionId: string; nonce?: string; token?: string }) => Promise<FlappyCheck>;

/** Schedules outside the animation loop. The database owns deadlines and nonces. */
export class FlappyInvisibleVerification {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | null = null;
  private stopped = false;
  private closing = false;
  private check: FlappyCheck;
  constructor(private sessionId: string, private config: FlappyCheckConfiguration,
    private transport: Transport, private token: (siteKey: string, nonce: string) => Promise<string>) {
    this.check = config;
  }
  start() { this.schedule(); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
  private schedule(retry = false) {
    if (this.stopped || this.closing || !this.check.required) return;
    const delay = retry ? 2500 : Math.max(100, Date.parse(this.check.nextDueAt!) - Date.parse(this.check.serverNow));
    this.timer = setTimeout(() => {
      void this.run().then(() => this.schedule(), () => this.schedule(true));
    }, delay);
  }
  private run(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const status = await this.transport({ sessionId: this.sessionId });
      if (this.stopped) return;
      this.check = status;
      if (!status.required || !status.due) return;
      if (!status.nonce) throw new Error("Verification unavailable");
      const token = await this.token(this.config.siteKey, status.nonce);
      if (this.stopped) return;
      this.check = await this.transport({ sessionId: this.sessionId, nonce: status.nonce, token });
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  async finish(collisionAt: number) {
    this.closing = true;
    clearTimeout(this.timer);
    // A short run has no due challenge, even if the final request is delayed.
    if (!this.check.required || collisionAt < Date.parse(this.check.nextDueAt!)) return;
    if (this.pending) await this.pending.catch(() => {});
    if (collisionAt >= Date.parse(this.check.nextDueAt!)) await this.run();
    if (this.stopped || (this.check.required && collisionAt >= Date.parse(this.check.nextDueAt!))) {
      throw new Error("Verification pending");
    }
  }
}
