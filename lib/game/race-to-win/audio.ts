export type RaceToWinAudioCue = "engine" | "lane-change" | "countdown" | "collision";

export type RaceToWinAudioSources = Readonly<Partial<Record<RaceToWinAudioCue, string>>>;

/**
 * Browser-audio boundary for future owned sound assets. This phase registers
 * no URLs, so it does not fetch, autoplay, or synthesize placeholder sounds.
 */
export class RaceToWinAudio {
  private readonly sources: RaceToWinAudioSources;
  private muted = false;
  private unlocked = false;
  private readonly activeAudio = new Set<HTMLAudioElement>();

  public constructor(sources: RaceToWinAudioSources = {}) {
    this.sources = sources;
  }

  /** Call only after a direct player gesture. */
  public unlock(): void {
    this.unlocked = true;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    for (const audio of this.activeAudio) audio.muted = muted;
  }

  public play(cue: RaceToWinAudioCue, options: { loop?: boolean; volume?: number } = {}): void {
    const source = this.sources[cue];
    if (!this.unlocked || this.muted || !source) return;

    const audio = new Audio(source);
    audio.loop = options.loop ?? false;
    audio.volume = Math.min(Math.max(options.volume ?? 0.6, 0), 1);
    audio.muted = this.muted;
    audio.addEventListener("ended", () => this.activeAudio.delete(audio), { once: true });
    this.activeAudio.add(audio);
    void audio.play().catch(() => {
      // Missing/blocked audio must never interrupt gameplay or expose details.
      this.activeAudio.delete(audio);
    });
  }

  public dispose(): void {
    for (const audio of this.activeAudio) {
      audio.pause();
      audio.currentTime = 0;
    }
    this.activeAudio.clear();
  }
}
