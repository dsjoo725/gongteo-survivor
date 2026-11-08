import { ARENA, COMBAT } from './config';
import { TICKS_PER_SECOND } from './simulation';

export interface ActorStats {
  attackDamage: number;
  attackSpeed: number;
  critChance: number;
  critMultiplier: number;
  maxHealth: number;
  moveSpeed: number;
  size: number;
  lifesteal: number;
}

export type PlayerStats = ActorStats;

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
  return createActorStats(DEFAULT_PLAYER_STATS, overrides);
}

export function createActorStats(
  defaults: Readonly<ActorStats>, overrides: Partial<ActorStats> = {}, baseRadius = COMBAT.playerRadius,
): Readonly<ActorStats> {
  const stats = { ...defaults, ...overrides };
  for (const key of Object.keys(DEFAULT_PLAYER_STATS) as (keyof PlayerStats)[]) {
    const value = stats[key];
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid actor stat: ${key}`);
  }
  if (stats.maxHealth === 0 || stats.size === 0 || stats.critMultiplier < 1
    || stats.critChance > 1 || stats.lifesteal > 1
    || baseRadius * stats.size > Math.min(ARENA.width, ARENA.height) / 2
    || !Number.isFinite(stats.attackDamage * stats.critMultiplier)) {
    throw new Error('Actor stats exceed their allowed ranges.');
  }
  return Object.freeze(stats);
}

export function playerRadius(stats: Readonly<PlayerStats>): number {
  return COMBAT.playerRadius * stats.size;
}

export function shotIntervalTicks(stats: Readonly<ActorStats>): number {
  return stats.attackSpeed === 0 ? Infinity : TICKS_PER_SECOND / stats.attackSpeed;
}

export function attackDamage(stats: Readonly<ActorStats>, random: () => number): number {
  const critical = stats.critChance === 1 || (stats.critChance > 0 && random() < stats.critChance);
  return stats.attackDamage * (critical ? stats.critMultiplier : 1);
}

export function formatStat(value: number): string {
  // Avoid showing a positive fractional HP value as zero after rounding.
  return value > 0 && value < 0.01 ? '<0.01' : String(Number(value.toFixed(2)));
}

export interface StatModifier {
  readonly id: string;
  readonly add?: Readonly<Partial<ActorStats>>;
  readonly multiply?: Readonly<Partial<ActorStats>>;
  readonly expiresAtTick?: number;
}

// Changes are validated before committing. Replacing/removing an effect always
// recalculates from base values, avoiding inverse arithmetic and stacking drift.
export class StatBlock {
  private base: Readonly<ActorStats>;
  private effects = new Map<string, Readonly<StatModifier>>();
  private effective: Readonly<ActorStats>;

  constructor(base: Readonly<ActorStats>, private readonly baseRadius: number) {
    this.base = createActorStats(base, {}, baseRadius);
    this.effective = this.base;
  }

  get value(): Readonly<ActorStats> { return this.effective; }
  get baseValue(): Readonly<ActorStats> { return this.base; }
  get modifiers(): readonly Readonly<StatModifier>[] { return Array.from(this.effects.values()); }

  setBase(patch: Partial<ActorStats>): void {
    const base = createActorStats(this.base, patch, this.baseRadius);
    const effective = this.validateTimeline(base, this.effects);
    this.base = base;
    this.effective = effective;
  }

  upsert(modifier: StatModifier, tick: number): void {
    if (!modifier.id || (modifier.expiresAtTick !== undefined
      && (!Number.isSafeInteger(modifier.expiresAtTick) || modifier.expiresAtTick <= tick))) {
      throw new Error('A modifier needs an ID and a future expiry tick.');
    }
    for (const [mode, values] of [['add', modifier.add], ['multiply', modifier.multiply]] as const) {
      for (const [key, value] of Object.entries(values ?? {})) {
        if (!(key in DEFAULT_PLAYER_STATS) || typeof value !== 'number' || !Number.isFinite(value)
          || (mode === 'multiply' && value < 0)) throw new Error(`Invalid modifier: ${key}`);
      }
    }
    const copy = Object.freeze({ ...modifier,
      add: modifier.add && Object.freeze({ ...modifier.add }),
      multiply: modifier.multiply && Object.freeze({ ...modifier.multiply }),
    });
    const effects = new Map(this.effects).set(copy.id, copy);
    const effective = this.validateTimeline(this.base, effects);
    this.effects = effects;
    this.effective = effective;
  }

  remove(id: string): void {
    if (!this.effects.has(id)) return;
    const effects = new Map(this.effects);
    effects.delete(id);
    const effective = this.validateTimeline(this.base, effects);
    this.effects = effects;
    this.effective = effective;
  }

  expire(tick: number): void {
    const effects = new Map(Array.from(this.effects).filter(([, effect]) =>
      effect.expiresAtTick === undefined || effect.expiresAtTick > tick));
    if (effects.size === this.effects.size) return;
    const effective = this.calculate(this.base, effects);
    this.effects = effects;
    this.effective = effective;
  }

  private calculate(base: Readonly<ActorStats>, effects: ReadonlyMap<string, Readonly<StatModifier>>): Readonly<ActorStats> {
    const ordered = Array.from(effects.values()).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const next = { ...base };
    for (const key of Object.keys(base) as (keyof ActorStats)[]) {
      let add = 0, multiply = 1;
      for (const effect of ordered) {
        add += effect.add?.[key] ?? 0;
        multiply *= effect.multiply?.[key] ?? 1;
      }
      next[key] = (base[key] + add) * multiply;
    }
    return createActorStats(base, next, this.baseRadius);
  }

  private validateTimeline(base: Readonly<ActorStats>, effects: ReadonlyMap<string, Readonly<StatModifier>>): Readonly<ActorStats> {
    const effective = this.calculate(base, effects);
    // Accept only combinations whose scheduled expiries remain valid too.
    // A temporary +HP effect must not hide an invalid permanent -HP modifier.
    const deadlines = new Set(Array.from(effects.values()).flatMap(effect => effect.expiresAtTick === undefined ? [] : [effect.expiresAtTick]));
    for (const tick of deadlines) this.calculate(base, new Map(Array.from(effects).filter(([, effect]) =>
      effect.expiresAtTick === undefined || effect.expiresAtTick > tick)));
    return effective;
  }
}
