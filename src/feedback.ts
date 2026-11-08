import Phaser from 'phaser';
import type { Point } from './rules';

type Image = Phaser.Physics.Arcade.Image;
type EnemyHit = { position: Point; ageMs: number };
type EnemyDeath = {
  position: Point;
  ageMs: number;
  radius: number;
  scale: number;
  visualScale: number;
  bob: number;
  visual: Phaser.GameObjects.Image;
};

const HIT_DURATION_MS = 80;
const DEATH_DURATION_MS = 100;
const PLAYER_HIT_DURATION_MS = 120;

export class HitFeedback {
  reducedEffects = false;
  private readonly enemyHits = new Map<number, EnemyHit>();
  private readonly enemyDeaths = new Map<number, EnemyDeath>();
  private playerHitAgeMs = Infinity;

  constructor(private readonly scene: Phaser.Scene) {}

  enemyHit(id: number, position: Point): void {
    // Actual recoil belongs to the fixed simulation, never the rendering clock.
    this.enemyHits.set(id, { position: { ...position }, ageMs: 0 });
  }

  enemyDeath(id: number, enemy: Image, source: Phaser.GameObjects.Image = enemy): void {
    this.enemyHits.delete(id);
    this.enemyDeaths.get(id)?.visual.destroy();
    // This short-lived visual has no physics body and cannot mark a pooled enemy.
    const position = { x: enemy.body!.center.x, y: enemy.body!.center.y };
    const bob = Math.abs(source.angle / 2);
    const visual = this.scene.add.image(position.x, position.y - bob, source.texture.key, source.frame.name)
      .setOrigin(source.originX, source.originY).setScale(source.scaleX).setDepth(source.depth)
      .setFlipX(source.flipX).setAngle(source.angle);
    this.enemyDeaths.set(id, { position, ageMs: 0, radius: enemy.body!.halfWidth,
      scale: enemy.scaleX, visualScale: source.scaleX, bob, visual });
  }

  playerHit(): void {
    this.playerHitAgeMs = 0;
  }

  advance(deltaMs: number): void {
    const elapsedMs = Number.isFinite(deltaMs) && deltaMs > 0 ? Math.min(deltaMs, 250) : 0;
    this.playerHitAgeMs += elapsedMs;
    for (const [id, hit] of this.enemyHits) {
      hit.ageMs += elapsedMs;
      if (hit.ageMs >= HIT_DURATION_MS) this.enemyHits.delete(id);
    }
    for (const [id, death] of this.enemyDeaths) {
      death.ageMs += elapsedMs;
      if (death.ageMs >= DEATH_DURATION_MS) {
        death.visual.destroy();
        this.enemyDeaths.delete(id);
      }
    }
  }

  render(player: Image): void {
    player.clearTint();
    if (this.playerHitAgeMs < PLAYER_HIT_DURATION_MS) {
      // Multiply only darkens the existing blue; no white or red flash.
      player.setTint(this.reducedEffects ? 0xd9dfe2 : 0x9daeb5).setTintMode(Phaser.TintModes.MULTIPLY);
    }
    for (const { visual, visualScale, ageMs } of this.enemyDeaths.values()) {
      const progress = ageMs / DEATH_DURATION_MS;
      visual.setScale(this.reducedEffects ? visualScale : visualScale * (1 - progress));
      visual.setAlpha(this.reducedEffects ? 1 - progress : 1);
    }
  }

  snapshot() {
    return {
      enemyHits: Array.from(this.enemyHits, ([id, { position, ageMs }]) => ({ id, ...position, ageMs })),
      enemyDeaths: Array.from(this.enemyDeaths, ([id, { position, ageMs, radius, scale, visualScale, visual }]) => ({
        id, ...position, ageMs, radius, texture: visual.texture.key, scale: scale * visual.scaleX / visualScale, alpha: visual.alpha,
      })),
      playerHitActive: this.playerHitAgeMs < PLAYER_HIT_DURATION_MS,
    };
  }

  resize(previous: { width: number; height: number }, next: { width: number; height: number }): void {
    const reposition = (position: Point) => {
      position.x *= next.width / previous.width;
      position.y *= next.height / previous.height;
    };
    for (const hit of this.enemyHits.values()) reposition(hit.position);
    for (const death of this.enemyDeaths.values()) {
      reposition(death.position);
      death.visual.setPosition(death.position.x, death.position.y - death.bob);
    }
  }

  dispose(): void {
    this.enemyHits.clear();
    for (const death of this.enemyDeaths.values()) death.visual.destroy();
    this.enemyDeaths.clear();
    this.playerHitAgeMs = Infinity;
  }
}
