import { TICKS_PER_SECOND } from './simulation';

// Fractional attack credit survives stat changes. Idle time can ready one shot,
// but cannot bank a burst. Multiple attacks in one tick share one visual packet.
export class AttackClock {
  private credit = 1;
  private idle = true;

  advance(attackSpeed: number, hasTarget: boolean): number {
    if (attackSpeed === 0) { this.credit = 1; this.idle = true; return 0; }
    const gain = attackSpeed / TICKS_PER_SECOND;
    if (!hasTarget) {
      this.credit = Math.min(1, this.credit + gain);
      this.idle = true;
      return 0;
    }
    if (this.idle && this.credit >= 1) this.credit = Math.max(1, gain);
    else this.credit += gain;
    this.idle = false;
    const attacks = Math.floor(this.credit + 1e-9);
    this.credit = Math.max(0, this.credit - attacks);
    return attacks;
  }
}
