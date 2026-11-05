export const TICKS_PER_SECOND = 60;
const TICK_EPSILON = 1e-9;
const MAX_FRAME_MS = 250;
const MAX_FRAME_TICKS = 4;

export class FixedClock {
  private debtTicks = 0;

  advanceFrame(deltaMs: number, step: () => boolean): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.debtTicks += Math.min(deltaMs, MAX_FRAME_MS) * TICKS_PER_SECOND / 1000;

    for (let count = 0; count < MAX_FRAME_TICKS && this.debtTicks + TICK_EPSILON >= 1; count += 1) {
      this.debtTicks = Math.max(0, this.debtTicks - 1);
      if (!step()) {
        this.clear();
        return;
      }
    }

    if (this.debtTicks + TICK_EPSILON >= 1) {
      this.debtTicks = Math.max(0, this.debtTicks - Math.floor(this.debtTicks + TICK_EPSILON));
    }
  }

  clear(): void {
    this.debtTicks = 0;
  }
}
