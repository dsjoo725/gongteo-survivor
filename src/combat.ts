import { COMBAT } from './config';
import { StatBlock, type ActorStats, type StatModifier } from './stats';

export type ActorRef = Readonly<{ kind: 'player' | 'enemy'; id: number }>;
export type AttackKind = 'projectile' | 'contact' | 'effect';

export class CombatActor {
  readonly ref: ActorRef;
  readonly statBlock: StatBlock;
  health: number;
  protectedUntilTick = 0;

  constructor(ref: ActorRef, stats: Readonly<ActorStats>, radius: number) {
    this.ref = Object.freeze({ ...ref });
    this.statBlock = new StatBlock(stats, radius);
    this.health = stats.maxHealth;
  }

  get stats(): Readonly<ActorStats> { return this.statBlock.value; }
  get maxHealth(): number { return this.stats.maxHealth; }
  get alive(): boolean { return this.health > 0; }

  heal(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0 || !this.alive) return 0;
    const healed = Math.min(amount, Math.max(0, this.maxHealth - this.health));
    this.health += healed;
    return healed;
  }

  reconcileHealth(): void {
    // Max HP increases never grant free healing; decreases clamp current HP.
    this.health = Math.min(this.health, this.maxHealth);
  }
}

export interface AttackSnapshot {
  readonly id: number;
  readonly source: ActorRef;
  readonly kind: AttackKind;
  readonly damage: number;
  readonly critical: boolean;
  readonly lifesteal: number;
  readonly count: number;
  readonly projectileId?: number;
}

export interface DamageResult {
  readonly damage: number;
  readonly hits: number;
  readonly healthBefore: number;
  readonly healthAfter: number;
  readonly killed: boolean;
  readonly blocked: boolean;
}

// Pure resolution is shared by contact, projectiles and future derived damage.
export function resolveDamage(
  target: { health: number; protectedUntilTick: number }, attack: Pick<AttackSnapshot, 'damage'>,
  tick: number, count = 1,
): DamageResult {
  const healthBefore = target.health;
  const blocked = healthBefore <= 0 || tick < target.protectedUntilTick
    || !Number.isFinite(attack.damage) || attack.damage <= 0 || !Number.isInteger(count) || count <= 0;
  const damage = blocked ? 0 : Math.min(healthBefore, attack.damage * count);
  return Object.freeze({ damage, hits: damage > 0 ? Math.min(count, Math.ceil(healthBefore / attack.damage)) : 0,
    healthBefore, healthAfter: Math.max(0, healthBefore - damage), killed: damage > 0 && damage >= healthBefore, blocked });
}

type EventBase = Readonly<{ tick: number }>;
export type CombatEvent =
  | EventBase & Readonly<{ type: 'attack'; attack: AttackSnapshot }>
  | EventBase & Readonly<{ type: 'hit'; attack: AttackSnapshot; target: ActorRef; damage: number; hits: number; healthBefore: number; healthAfter: number }>
  | EventBase & Readonly<{ type: 'heal'; source: ActorRef; target: ActorRef; amount: number; healthAfter: number }>
  | EventBase & Readonly<{ type: 'death'; attack: AttackSnapshot; target: ActorRef }>
  | EventBase & Readonly<{ type: 'kill'; attack: AttackSnapshot; target: ActorRef }>
  | EventBase & Readonly<{ type: 'statsChanged'; target: ActorRef; before: Readonly<ActorStats>; after: Readonly<ActorStats>; health: number }>;

export class CombatEvents {
  private pending: CombatEvent[] = [];
  private listeners = new Set<(event: CombatEvent) => void>();
  private dispatching = false;

  subscribe(listener: (event: CombatEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  on<T extends CombatEvent['type']>(type: T, listener: (event: Extract<CombatEvent, { type: T }>) => void): () => void {
    return this.subscribe(event => { if (event.type === type) listener(event as Extract<CombatEvent, { type: T }>); });
  }

  emit(event: CombatEvent): void {
    const immutable = { ...event,
      ...('attack' in event ? { attack: Object.freeze({ ...event.attack, source: Object.freeze({ ...event.attack.source }) }) } : {}),
      ...('source' in event ? { source: Object.freeze({ ...event.source }) } : {}),
      ...('target' in event ? { target: Object.freeze({ ...event.target }) } : {}),
    } as CombatEvent;
    this.pending.push(Object.freeze(immutable));
  }

  flush(): void {
    if (this.dispatching) return;
    const batch = this.pending.splice(0);
    this.dispatching = true;
    try {
      // Events created by a handler wait for the next flush: no recursive chain.
      for (const event of batch) for (const listener of Array.from(this.listeners)) listener(event);
    } finally { this.dispatching = false; }
  }

  clear(): void { this.pending.length = 0; this.listeners.clear(); }
}

export type CombatCommand =
  | { type: 'damage'; target: ActorRef; attack: AttackSnapshot; count?: number }
  | { type: 'heal'; source: ActorRef; target: ActorRef; amount: number }
  | { type: 'baseStats'; target: ActorRef; patch: Partial<ActorStats> }
  | { type: 'modifier'; target: ActorRef; modifier: StatModifier }
  | { type: 'removeModifier'; target: ActorRef; id: string };

const keyOf = (ref: ActorRef): string => `${ref.kind}:${ref.id}`;

export class CombatSession {
  readonly events = new CombatEvents();
  private readonly actors = new Map<string, CombatActor>();
  private commands: CombatCommand[] = [];
  private nextAttackId = 0;
  tick = 0;

  constructor(private readonly random: () => number) {}

  add(actor: CombatActor): void { this.actors.set(keyOf(actor.ref), actor); }
  remove(ref: ActorRef): void { this.actors.delete(keyOf(ref)); }
  get(ref: ActorRef): CombatActor | undefined { return this.actors.get(keyOf(ref)); }

  // Handlers queue reactions for the next fixed tick. Pauses stop this queue too.
  enqueue(command: CombatCommand): void { this.commands.push(structuredClone(command)); }

  beginTick(tick: number): void {
    this.tick = tick;
    for (const actor of this.actors.values()) this.change(actor, () => actor.statBlock.expire(tick));
    const commands = this.commands.splice(0);
    for (const command of commands) {
      const target = this.get(command.target);
      if (!target) continue;
      if (command.type === 'damage') this.applyAttack(command.attack, target, command.count);
      else if (command.type === 'heal') this.heal(command.source, target, command.amount);
      else if (command.type === 'baseStats') this.setBase(target.ref, command.patch);
      else if (command.type === 'modifier') this.upsertModifier(target.ref, command.modifier);
      else this.removeModifier(target.ref, command.id);
    }
  }

  createAttack(source: CombatActor, kind: AttackKind, count = 1, projectileId?: number): AttackSnapshot {
    if (!Number.isInteger(count) || count <= 0) throw new Error('Invalid attack count.');
    const stats = source.stats;
    const critical = kind === 'projectile' && (stats.critChance === 1
      || (stats.critChance > 0 && this.random() < stats.critChance));
    const attack = Object.freeze({ id: ++this.nextAttackId, source: source.ref, kind, count, projectileId,
      damage: stats.attackDamage * (critical ? stats.critMultiplier : 1), critical,
      lifesteal: kind === 'projectile' ? stats.lifesteal : 0 });
    this.events.emit({ type: 'attack', tick: this.tick, attack });
    return attack;
  }

  applyAttack(attack: AttackSnapshot, target: CombatActor, count = attack.count): DamageResult {
    const result = resolveDamage(target, attack, this.tick, Math.min(count, attack.count));
    if (result.damage === 0) return result;
    target.health = result.healthAfter;
    if (target.ref.kind === 'player') target.protectedUntilTick = this.tick + COMBAT.damageCooldownTicks;
    this.events.emit({ type: 'hit', tick: this.tick, attack, target: target.ref,
      damage: result.damage, hits: result.hits, healthBefore: result.healthBefore, healthAfter: result.healthAfter });
    const source = this.get(attack.source);
    if (source && attack.lifesteal > 0) this.heal(attack.source, source, result.damage * attack.lifesteal);
    if (result.killed) {
      this.events.emit({ type: 'death', tick: this.tick, attack, target: target.ref });
      this.events.emit({ type: 'kill', tick: this.tick, attack, target: target.ref });
    }
    return result;
  }

  heal(source: ActorRef, target: CombatActor, amount: number): number {
    const healed = target.heal(amount);
    if (healed > 0) this.events.emit({ type: 'heal', tick: this.tick, source, target: target.ref, amount: healed, healthAfter: target.health });
    return healed;
  }

  setBase(ref: ActorRef, patch: Partial<ActorStats>): void {
    const actor = this.require(ref);
    this.change(actor, () => actor.statBlock.setBase(patch));
  }

  upsertModifier(ref: ActorRef, modifier: StatModifier): void {
    const actor = this.require(ref);
    this.change(actor, () => actor.statBlock.upsert(modifier, this.tick));
  }

  removeModifier(ref: ActorRef, id: string): void {
    const actor = this.require(ref);
    this.change(actor, () => actor.statBlock.remove(id));
  }

  private require(ref: ActorRef): CombatActor {
    const actor = this.get(ref);
    if (!actor) throw new Error(`Unknown actor: ${keyOf(ref)}`);
    return actor;
  }

  private change(actor: CombatActor, change: () => void): void {
    const before = actor.stats;
    change();
    if (actor.stats === before) return;
    actor.reconcileHealth();
    this.events.emit({ type: 'statsChanged', tick: this.tick, target: actor.ref, before, after: actor.stats, health: actor.health });
  }

  dispose(): void { this.commands.length = 0; this.actors.clear(); this.events.clear(); }
}
