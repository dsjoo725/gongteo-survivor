import { expect, test } from '@playwright/test';
import { AttackClock } from '../src/attacks';
import { sweptCircleTime } from '../src/collision';
import { CombatActor, CombatEvents, CombatSession, type CombatEvent } from '../src/combat';
import { createPlayerStats, StatBlock } from '../src/stats';
import { createEnemyStats } from '../src/enemies';

const playerRef = { kind: 'player' as const, id: 0 };
const enemyRef = { kind: 'enemy' as const, id: 1 };

for (const [speed, expected] of [[2.5, 5], [7, 14], [60, 120], [120, 240], [1000, 2000], [60_000_000, 120_000_000]]) {
  test(`attack speed ${speed} preserves its rate without a per-tick attack cap`, () => {
    const clock = new AttackClock();
    let attacks = 0;
    for (let i = 0; i < 120; i++) attacks += clock.advance(speed, true);
    expect(attacks).toBe(expected);
  });
}

test('idle time cannot bank a burst and fractional attack progress survives rate changes', () => {
  const clock = new AttackClock();
  for (let i = 0; i < 1000; i++) expect(clock.advance(120, false)).toBe(0);
  expect(clock.advance(120, true)).toBe(2);
  expect(clock.advance(0, true)).toBe(0);
  expect(clock.advance(1, true)).toBe(1);
  for (let i = 0; i < 30; i++) expect(clock.advance(1, true)).toBe(0);
  let afterChange = 0;
  for (let i = 0; i < 15; i++) afterChange += clock.advance(2, true);
  expect(afterChange).toBe(1);
});

test('swept circles detect grazing, tiny targets, crossing motion, tangency and initial overlap', () => {
  expect(sweptCircleTime({ x: 296.5, y: 332.9 }, { x: 303.5, y: 332.9 }, { x: 300, y: 320 }, { x: 300, y: 320 }, 13)).toBeDefined();
  expect(sweptCircleTime({ x: 296.5, y: 320 }, { x: 303.5, y: 320 }, { x: 300, y: 320 }, { x: 300, y: 320 }, 3.1)).toBeDefined();
  expect(sweptCircleTime({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: -10, y: 0 }, 1)).toBeCloseTo(0.475);
  expect(sweptCircleTime({ x: -10, y: 1 }, { x: 10, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toBeCloseTo(0.5);
  expect(sweptCircleTime({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toBe(0);
  expect(sweptCircleTime({ x: -10, y: 2 }, { x: 10, y: 2 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toBeUndefined();
});

test('modifiers replace by ID, compute in deterministic order and remove without drift', () => {
  const block = new StatBlock(createPlayerStats(), 12);
  block.upsert({ id: 'power', add: { attackDamage: 2 } }, 0);
  block.upsert({ id: 'double', multiply: { attackDamage: 2 } }, 0);
  expect(block.value.attackDamage).toBe(6);
  block.upsert({ id: 'power', add: { attackDamage: 3 } }, 0);
  expect(block.value.attackDamage).toBe(8);
  block.setBase({ attackDamage: 2 });
  expect(block.value.attackDamage).toBe(10);
  block.remove('power');
  expect(block.value.attackDamage).toBe(4);
  block.remove('double');
  expect(block.value.attackDamage).toBe(2);
  expect(Object.isFrozen(block.value)).toBe(true);
});

test('invalid changes and invalid future expiry states are rejected atomically', () => {
  const block = new StatBlock(createPlayerStats(), 12);
  block.upsert({ id: 'temporary-hp', add: { maxHealth: 10 }, expiresAtTick: 5 }, 0);
  const before = block.value;
  expect(() => block.upsert({ id: 'invalid-dependency', add: { maxHealth: -5 } }, 0)).toThrow();
  expect(() => block.setBase({ size: 100 })).toThrow();
  expect(block.value).toBe(before);
  expect(block.modifiers.map(mod => mod.id)).toEqual(['temporary-hp']);
  block.expire(4);
  expect(block.value.maxHealth).toBe(13);
  block.expire(5);
  expect(block.value.maxHealth).toBe(3);
});

test('common damage commits hit, actual lifesteal and one death/kill, without resurrection or duplicate rewards', () => {
  const session = new CombatSession(() => 0);
  const player = new CombatActor(playerRef, createPlayerStats({ attackDamage: 10, lifesteal: 0.5 }), 12);
  const enemy = new CombatActor(enemyRef, createEnemyStats(), 10);
  player.health = 1;
  session.add(player); session.add(enemy);
  const events: CombatEvent[] = [];
  session.events.subscribe(event => events.push(event));
  session.beginTick(1);
  const attack = session.createAttack(player, 'projectile', 10);
  const result = session.applyAttack(attack, enemy);
  expect(result).toMatchObject({ damage: 2, hits: 1, killed: true });
  expect(player.health).toBe(2);
  expect(session.applyAttack(attack, enemy).damage).toBe(0);
  session.events.flush();
  expect(events.map(event => event.type)).toEqual(['attack', 'hit', 'heal', 'death', 'kill']);
  player.health = 0;
  expect(session.heal(enemyRef, player, 100)).toBe(0);
});

test('contact uses attack damage and shared immunity while ignoring active-attack crit and lifesteal', () => {
  const session = new CombatSession(() => 0);
  const player = new CombatActor(playerRef, createPlayerStats({ maxHealth: 10 }), 12);
  const enemy = new CombatActor(enemyRef, createEnemyStats({ attackDamage: 2, critChance: 1, lifesteal: 1 }), 10);
  enemy.health = 1;
  session.add(player); session.add(enemy);
  session.beginTick(1);
  const attack = session.createAttack(enemy, 'contact');
  expect(attack).toMatchObject({ damage: 2, critical: false, lifesteal: 0 });
  expect(session.applyAttack(attack, player).damage).toBe(2);
  session.beginTick(48);
  expect(session.applyAttack(attack, player).damage).toBe(0);
  session.beginTick(49);
  expect(session.applyAttack(attack, player).damage).toBe(2);
  expect(enemy.health).toBe(1);
});

test('max HP changes clamp without healing and emitted stats snapshots stay immutable', () => {
  const session = new CombatSession(() => 1);
  const player = new CombatActor(playerRef, createPlayerStats(), 12);
  session.add(player);
  player.health = 2;
  session.setBase(playerRef, { maxHealth: 10 });
  expect(player.health).toBe(2);
  session.setBase(playerRef, { maxHealth: 1 });
  expect(player.health).toBe(1);
  player.health = 0;
  session.setBase(playerRef, { maxHealth: 100 });
  expect(player.health).toBe(0);
});

test('attack snapshots preserve fire-time damage, critical and lifesteal after stats change', () => {
  const session = new CombatSession(() => 0);
  const player = new CombatActor(playerRef, createPlayerStats({ lifesteal: 0.25 }), 12);
  session.add(player);
  const before = session.createAttack(player, 'projectile');
  session.setBase(playerRef, { attackDamage: 10, critChance: 1, critMultiplier: 3, lifesteal: 1 });
  const after = session.createAttack(player, 'projectile');
  expect(before).toMatchObject({ damage: 1, critical: false, lifesteal: 0.25 });
  expect(after).toMatchObject({ damage: 30, critical: true, lifesteal: 1 });
  expect(Object.isFrozen(before)).toBe(true);
  expect(Object.isFrozen(before.source)).toBe(true);
});

test('event hooks are unsubscribable, immutable and nonrecursive, with reactions on the next tick', () => {
  const bus = new CombatEvents();
  const received: CombatEvent[] = [];
  const off = bus.subscribe(event => {
    received.push(event);
    if (received.length === 1) { bus.emit(event); bus.flush(); }
  });
  bus.emit({ type: 'heal', tick: 1, source: playerRef, target: playerRef, amount: 1, healthAfter: 2 });
  bus.flush();
  expect(received).toHaveLength(1);
  expect(Object.isFrozen(received[0])).toBe(true);
  off(); bus.flush();
  expect(received).toHaveLength(1);

  const session = new CombatSession(() => 1);
  const player = new CombatActor(playerRef, createPlayerStats(), 12);
  const enemy = new CombatActor(enemyRef, createEnemyStats(), 10);
  session.add(player); session.add(enemy); player.health = 1;
  session.events.on('kill', () => session.enqueue({ type: 'heal', source: playerRef, target: playerRef, amount: 0.5 }));
  session.beginTick(1);
  session.applyAttack(session.createAttack(player, 'projectile', 2), enemy);
  session.events.flush();
  expect(player.health).toBe(1);
  session.beginTick(2);
  expect(player.health).toBe(1.5);
  session.dispose();
  expect(session.get(playerRef)).toBeUndefined();
});
