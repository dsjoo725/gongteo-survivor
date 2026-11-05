import { ARENA, COMBAT } from './rules';
import { TICKS_PER_SECOND } from './simulation';

export interface PlayerStats {
  attackDamage: number;
  attackSpeed: number;
  critChance: number;
  critMultiplier: number;
  maxHealth: number;
  moveSpeed: number;
  size: number;
  lifesteal: number;
}

// Edit these values to configure ordinary runs. Each run gets its own frozen copy.
export const DEFAULT_PLAYER_STATS: Readonly<PlayerStats> = Object.freeze({
  attackDamage: 1,
  attackSpeed: TICKS_PER_SECOND / COMBAT.shotIntervalTicks,
  critChance: 0,
  critMultiplier: 2,
  maxHealth: COMBAT.maxHealth,
  moveSpeed: COMBAT.playerSpeed,
  size: 1,
  lifesteal: 0,
});

export function createPlayerStats(overrides: Partial<PlayerStats> = {}): Readonly<PlayerStats> {
  const stats = { ...DEFAULT_PLAYER_STATS, ...overrides };
  for (const key of Object.keys(DEFAULT_PLAYER_STATS) as (keyof PlayerStats)[]) {
    const value = stats[key];
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid player stat: ${key}`);
  }
  if (stats.maxHealth === 0 || stats.size === 0 || stats.critMultiplier < 1
    || stats.critChance > 1 || stats.lifesteal > 1
    || playerRadius(stats) > Math.min(ARENA.width, ARENA.height) / 2
    || !Number.isFinite(stats.attackDamage * stats.critMultiplier)) {
    throw new Error('Player stats exceed their allowed ranges.');
  }
  return Object.freeze(stats);
}

export function playerRadius(stats: Readonly<PlayerStats>): number {
  return COMBAT.playerRadius * stats.size;
}

export function shotIntervalTicks(stats: Readonly<PlayerStats>): number {
  return stats.attackSpeed === 0 ? Infinity : Math.max(1, Math.ceil(TICKS_PER_SECOND / stats.attackSpeed));
}

export function attackDamage(stats: Readonly<PlayerStats>, random: () => number): number {
  const critical = stats.critChance === 1 || (stats.critChance > 0 && random() < stats.critChance);
  return stats.attackDamage * (critical ? stats.critMultiplier : 1);
}

export function formatStat(value: number): string {
  // Avoid showing a positive fractional HP value as zero after rounding.
  return value > 0 && value < 0.01 ? '<0.01' : String(Number(value.toFixed(2)));
}
