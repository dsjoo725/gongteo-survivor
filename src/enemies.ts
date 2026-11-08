import { COMBAT } from './rules';
import { createActorStats, type ActorStats } from './stats';
import { CombatActor } from './combat';

export const ENEMY_DEFINITION = Object.freeze({
  name: '추격형',
  color: 0xf2766b,
  outline: 0x672e29,
  stats: Object.freeze({
    attackDamage: 1, attackSpeed: 0, critChance: 0, critMultiplier: 2,
    maxHealth: 2, moveSpeed: COMBAT.enemySpeed, size: 1, lifesteal: 0,
  }) satisfies Readonly<ActorStats>,
});

export function createEnemyStats(overrides: Partial<ActorStats> = {}): Readonly<ActorStats> {
  return createActorStats(ENEMY_DEFINITION.stats, overrides, COMBAT.enemyRadius);
}

export function enemyRadius(stats: Readonly<ActorStats>): number {
  return COMBAT.enemyRadius * stats.size;
}

export class EnemyState extends CombatActor {
  recoilUntilTick = 0;
  appliedStats: Readonly<ActorStats>;

  constructor(readonly id: number, stats: Readonly<ActorStats>) {
    super({ kind: 'enemy', id }, stats, COMBAT.enemyRadius);
    this.appliedStats = this.stats;
  }
}
