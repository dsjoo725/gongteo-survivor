import { StatBlock, formatStat, type ActorStats, type StatModifier } from './stats';
import type { CombatActor } from './combat';
import { COMBAT } from './config';
import type { UpgradeSymbol } from './growth-visuals';

export type UpgradeId = keyof ActorStats;
export const MAX_UPGRADE_RANK = 5;
export const XP_PER_KILL = 1;
export const UPGRADE_IDS: readonly UpgradeId[] = Object.freeze([
  'attackDamage', 'attackSpeed', 'critChance', 'critMultiplier', 'maxHealth', 'moveSpeed', 'size', 'lifesteal',
]);

const details: Record<UpgradeId, { name: string; description: string; symbol: UpgradeSymbol }> = {
  attackDamage: { name: '공격력', description: '한 발의 피해가 증가합니다.', symbol: 'attack' },
  attackSpeed: { name: '공격 속도', description: '더 자주 자동 사격합니다.', symbol: 'speed' },
  critChance: { name: '치명타 확률', description: '강한 공격이 더 자주 나옵니다.', symbol: 'crit' },
  critMultiplier: { name: '치명타 피해', description: '치명타의 피해가 증가합니다.', symbol: 'burst' },
  maxHealth: { name: '최대 체력', description: '최대 체력이 늘어납니다.', symbol: 'health' },
  moveSpeed: { name: '이동 속도', description: '더 빠르게 이동합니다.', symbol: 'move' },
  size: { name: '몸집 축소', description: '작아져 적을 피하기 쉬워집니다.', symbol: 'size' },
  lifesteal: { name: '피해 흡혈', description: '준 피해의 일부를 회복합니다.', symbol: 'heal' },
};

export function levelXpCost(level: number): number { return 5 + (level - 1) * 3; }

export interface UpgradeChoice {
  readonly id: UpgradeId;
  readonly name: string;
  readonly description: string;
  readonly symbol: UpgradeSymbol;
  readonly rank: number;
  readonly before: string;
  readonly after: string;
  readonly effect: Readonly<StatModifier>;
}

function display(id: UpgradeId, value: number): string {
  return id === 'critChance' || id === 'lifesteal' || id === 'critMultiplier'
    ? `${formatStat(value * 100)}%` : id === 'size' ? `${formatStat(value)}배` : formatStat(value);
}

function upgradeEffect(id: UpgradeId, stats: Readonly<ActorStats>, key: string): StatModifier {
  if (id === 'size') return { id: key, multiply: { size: 0.9 } };
  const amount: Record<Exclude<UpgradeId, 'size'>, number> = {
    attackDamage: 0.5, attackSpeed: 0.5, critChance: Math.min(0.05, 1 - stats.critChance),
    critMultiplier: 0.25, maxHealth: 1, moveSpeed: 15, lifesteal: Math.min(0.02, 1 - stats.lifesteal),
  };
  return { id: key, add: { [id]: amount[id] } };
}

export function availableUpgrades(actor: CombatActor, ranks: Readonly<Record<UpgradeId, number>>, tick: number): UpgradeChoice[] {
  const choices: UpgradeChoice[] = [];
  for (const id of UPGRADE_IDS) {
    if (ranks[id] >= MAX_UPGRADE_RANK) continue;
    const effect = upgradeEffect(id, actor.stats, `level-up:${id}:${ranks[id] + 1}`);
    try {
      const preview = new StatBlock(actor.statBlock.baseValue, COMBAT.playerRadius);
      for (const existing of actor.statBlock.modifiers) preview.upsert(existing, tick);
      preview.upsert(effect, tick);
      if (preview.value[id] === actor.stats[id]) continue;
      choices.push(Object.freeze({ id, ...details[id], rank: ranks[id] + 1,
        before: display(id, actor.stats[id]), after: display(id, preview.value[id]),
        effect: Object.freeze({ ...effect, add: effect.add && Object.freeze({ ...effect.add }),
          multiply: effect.multiply && Object.freeze({ ...effect.multiply }) }) }));
    } catch { /* Do not offer a stat change that the combat model would reject. */ }
  }
  return choices;
}

export class Progression {
  level = 1;
  xp = 0;
  totalXp = 0;
  pending = 0;
  complete = false;
  readonly ranks: Record<UpgradeId, number> = Object.fromEntries(UPGRADE_IDS.map(id => [id, 0])) as Record<UpgradeId, number>;
  private rewardedKills = new Set<number>();
  private token = 0;
  private offered: readonly UpgradeChoice[] = [];

  constructor(readonly enabled: boolean, private readonly random: () => number) {}

  get nextXp(): number { return levelXpCost(this.level); }
  get offerId(): number { return this.token; }
  get choices(): readonly UpgradeChoice[] { return this.offered; }
  get rewardLevel(): number { return this.level - this.pending + 1; }

  awardKill(id: number): void {
    if (!this.enabled || this.complete || this.rewardedKills.has(id)) return;
    this.rewardedKills.add(id);
    this.gain(XP_PER_KILL);
  }

  gain(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(this.totalXp + amount)) throw new Error('Invalid experience amount.');
    if (!this.enabled || this.complete) return;
    this.totalXp += amount;
    this.xp += amount;
    while (this.xp >= this.nextXp) {
      this.xp -= this.nextXp;
      this.level += 1;
      this.pending += 1;
    }
  }

  offer(available: readonly UpgradeChoice[]): readonly UpgradeChoice[] {
    if (this.offered.length > 0 || this.pending === 0 || this.complete) return this.offered;
    if (available.length === 0) { this.complete = true; this.pending = 0; return []; }
    const pool = available.slice();
    const chosen: UpgradeChoice[] = [];
    while (chosen.length < 3 && pool.length > 0) {
      const index = Math.min(pool.length - 1, Math.floor(this.random() * pool.length));
      chosen.push(pool.splice(index, 1)[0]);
    }
    this.token += 1;
    this.offered = Object.freeze(chosen);
    return this.offered;
  }

  choose(token: number, id: UpgradeId, apply: (choice: UpgradeChoice) => void): boolean {
    const choice = this.offered.find(item => item.id === id);
    if (token !== this.token || !choice || this.pending === 0) return false;
    apply(choice); // A rejected combat change must not consume XP or a reward.
    this.ranks[id] += 1;
    this.pending -= 1;
    this.offered = [];
    this.complete = UPGRADE_IDS.every(key => this.ranks[key] === MAX_UPGRADE_RANK);
    if (this.complete) this.pending = 0;
    return true;
  }

  invalidateOffer(): void { this.offered = []; }

  snapshot() {
    return { enabled: this.enabled, level: this.level, xp: this.xp, nextXp: this.nextXp,
      totalXp: this.totalXp, pending: this.pending, complete: this.complete,
      offerId: this.token, choices: this.offered.map(choice => ({ ...choice })), ranks: { ...this.ranks } };
  }
}
