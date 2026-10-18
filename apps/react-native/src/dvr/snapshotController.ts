import { clampToWindow } from "./window";
import { deriveDvrState, detectLiveToVod, type DvrState, type PlayerSnapshot } from "./state";

export interface SnapshotPlayer {
  isLive(): Promise<boolean>;
  getDuration(): Promise<number>;
  getMaxTimeShift(): Promise<number>;
  getTimeShift(): Promise<number>;
  getCurrentTime(): Promise<number>;
  timeShift(offset: number): void;
}

export class SnapshotController {
  private previous: PlayerSnapshot | null = null;
  private timeShiftEnabled = true;
  private generation = 0;
  private seekSequence = 0;
  private disposed = false;
  private pending = false;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly player: SnapshotPlayer,
    private readonly onUpdate: (state: DvrState) => void,
    private readonly onLog: (message: string) => void,
  ) {}

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.pending = true;
    // Native events may arrive faster than the bridge reads. Keep one read and one pending refresh.
    this.inFlight ??= this.readPending().finally(() => {
      this.inFlight = null;
      // A refresh can arrive after the loop exits but before this completion callback.
      return this.pending && !this.disposed ? this.refresh() : undefined;
    });
    return this.inFlight;
  }

  sourceChanged(): void {
    this.generation++;
    this.previous = null;
    this.pending = false;
  }

  setTimeShiftEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.timeShiftEnabled = enabled;
    this.generation++;
    if (this.previous) this.onUpdate(deriveDvrState(this.previous, { timeShiftEnabled: enabled }));
  }

  dispose(): void {
    this.disposed = true;
    this.sourceChanged();
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private async readPending(): Promise<void> {
    while (this.pending && !this.disposed) {
      this.pending = false;
      const generation = this.generation;
      const reads = [
        this.player.isLive(), this.player.getDuration(), this.player.getMaxTimeShift(),
        this.player.getTimeShift(), this.player.getCurrentTime(),
      ] as const;
      try {
        const [isLive, duration, maxTimeShift, timeShift, currentTime] = await Promise.all(reads);
        if (!this.current(generation)) continue;
        const snapshot = { isLive, duration, maxTimeShift, timeShift, currentTime };
        if (this.previous && detectLiveToVod(this.previous, snapshot)) this.onLog("live→VOD detected (poll)");
        if (this.timeShiftEnabled && maxTimeShift < 0 && timeShift < maxTimeShift - 1) {
          this.onLog("DVR window exceeded → recover");
          this.player.timeShift(0);
        }
        this.previous = snapshot;
        this.onUpdate(deriveDvrState(snapshot, { timeShiftEnabled: this.timeShiftEnabled }));
      } catch {
        // A rejected read does not cancel the other native reads; wait before starting another batch.
        await Promise.allSettled(reads);
        if (this.current(generation) && !this.pending) this.onLog("Snapshot read failed");
      }
    }
  }

  async seek(offset: number): Promise<void> {
    if (this.disposed) return;
    const generation = this.generation;
    const sequence = ++this.seekSequence;
    if (!this.timeShiftEnabled) {
      this.player.timeShift(0);
      return;
    }
    try {
      const max = await this.player.getMaxTimeShift();
      if (this.current(generation) && sequence === this.seekSequence) {
        this.player.timeShift(clampToWindow(offset, max));
      }
    } catch {
      if (this.current(generation) && sequence === this.seekSequence) this.onLog("Seek read failed");
    }
  }
}
