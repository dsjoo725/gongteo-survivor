import Phaser from 'phaser';
import { COMBAT, type Point } from './rules';

type Image = Phaser.Physics.Arcade.Image;
type EnemyFlash = { position: Point; ageMs: number };

export class HitFeedback {
  private readonly enemyFlashes = new Map<number, EnemyFlash>();
  private playerFlashAgeMs = Infinity;
  private graphics?: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene) {}

  enemyHit(id: number, position: Point): void {
    this.enemyFlashes.set(id, { position: { ...position }, ageMs: 0 });
  }

  playerHit(): void {
    this.playerFlashAgeMs = 0;
  }

  advance(deltaMs: number): void {
    const elapsedMs = Number.isFinite(deltaMs) && deltaMs > 0 ? Math.min(deltaMs, 250) : 0;
    this.playerFlashAgeMs += elapsedMs;
    for (const [id, flash] of this.enemyFlashes) {
      flash.ageMs += elapsedMs;
      if (flash.ageMs >= 60) this.enemyFlashes.delete(id);
    }
  }

  render(player: Image, enemies: Iterable<[Image, { id: number }]>): void {
    player.clearTint();
    if (this.playerFlashAgeMs < 120) {
      player.setTint(0xff8a78).setTintMode(Phaser.TintModes.FILL);
    }

    const living = new Set<number>();
    for (const [enemy, { id }] of enemies) {
      living.add(id);
      enemy.clearTint();
      if (this.enemyFlashes.has(id)) {
        enemy.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      }
    }

    this.graphics?.clear();
    for (const [id, { position }] of this.enemyFlashes) {
      if (living.has(id)) continue;
      // A killed enemy's brief flash uses a position copy, never its pooled body.
      const graphics = this.graphics ??= this.scene.add.graphics().setDepth(3.5);
      graphics.fillStyle(0xffffff).fillCircle(position.x, position.y, COMBAT.enemyRadius);
    }
  }

  snapshot() {
    return {
      enemyFlashes: Array.from(this.enemyFlashes, ([id, { position, ageMs }]) => ({ id, ...position, ageMs })),
      playerFlashing: this.playerFlashAgeMs < 120,
    };
  }

  dispose(): void {
    this.enemyFlashes.clear();
    this.graphics?.destroy();
    this.graphics = undefined;
    this.playerFlashAgeMs = Infinity;
  }
}
