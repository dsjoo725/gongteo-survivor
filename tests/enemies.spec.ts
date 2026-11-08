import { expect, test, type Page } from '@playwright/test';
import { createEnemyStats, ENEMY_DEFINITION } from '../src/enemies';
import { DEFAULT_PLAYER_STATS } from '../src/stats';
import { spawnPoint } from '../src/rules';
import type { ArenaFixture } from '../src/testing';

const tickMs = 1000 / 60;

async function load(page: Page, fixture: ArenaFixture) {
  await page.goto('/?simtest=1');
  await page.waitForFunction(() => window.__arenaTest);
  await page.evaluate(fixture => window.__arenaTest!.configure({ progression: false, bounds: { width: 360, height: 640 }, ...fixture }), fixture);
}

async function advance(page: Page, ticks = 1) {
  return page.evaluate(({ ticks, tickMs }) => {
    for (let i = 0; i < ticks; i++) window.__arenaTest!.advanceFrame(tickMs);
    return window.__arenaTest!.snapshot();
  }, { ticks, tickMs });
}

test('the basic enemy retains eight validated stats, two HP, and no active attack', () => {
  const stats = createEnemyStats();
  expect(Object.keys(stats).sort()).toEqual(Object.keys(DEFAULT_PLAYER_STATS).sort());
  expect(Object.isFrozen(stats)).toBe(true);
  expect(stats).not.toBe(ENEMY_DEFINITION.stats);
  expect(stats).toMatchObject({ maxHealth: 2, attackDamage: 1, attackSpeed: 0, moveSpeed: 95, size: 1 });
  expect(createEnemyStats({ maxHealth: 5 }).maxHealth).toBe(5);
  expect(createEnemyStats()).toEqual(ENEMY_DEFINITION.stats);
  for (const overrides of [{ size: 19 }, { size: 0 }, { maxHealth: 0 }, { attackSpeed: -1 },
    { critChance: 1.1 }, { lifesteal: NaN }, { lifesteal: 1.1 }, { critMultiplier: 0.5 }]) {
    expect(() => createEnemyStats(overrides)).toThrow();
  }
});

test('spawn admission still accounts for both body radii when overriding size', () => {
  let draws = 0;
  const candidates = [0, 0.25];
  const point = spawnPoint({ x: 180, y: 320 }, () => candidates[draws++],
    [{ x: 25, y: 16, radius: 7.5 }], 12, { width: 360, height: 640 }, 16)!;
  expect(draws).toBe(2);
  expect(point.x).toBeGreaterThanOrEqual(16);
  expect(point.y).toBeGreaterThanOrEqual(16);
  expect(Math.hypot(point.x - 25, point.y - 16)).toBeGreaterThanOrEqual(23.5);
});

for (const attackDamage of [0, 0.5, 1, 2]) {
  test(`contact follows attack damage ${attackDamage} while attack speed and player immunity stay independent`, async ({ page }) => {
    for (const attackSpeed of [0, 1000]) {
      await load(page, { stats: { maxHealth: 100, attackSpeed: 0 },
        spawns: [{ tick: 24, position: { x: 158, y: 320, stats: { moveSpeed: 0, attackDamage } } }],
        enemies: [{ x: 204.5, y: 320, health: 2, stats: {
          attackDamage, attackSpeed, critChance: 1, critMultiplier: 10,
          maxHealth: 8, moveSpeed: 0, size: 1.25, lifesteal: 1,
        } }] });
      const first = await advance(page);
      expect(first.health).toBe(100 - attackDamage);
      expect(first.enemies[0].health).toBe(2);
      expect(first.enemies[0].bodyRadius).toBe(12.5);
      expect((await advance(page, 47)).health).toBe(100 - attackDamage);
      const second = await advance(page);
      expect(second.health).toBe(100 - attackDamage * 2);
      expect(second.enemies[0].health).toBe(2);
      const third = await advance(page, 48);
      expect(third.health).toBe(100 - attackDamage * 3);
      expect(third.events.filter(e => e.type === 'damage').map(e => e.tick))
        .toEqual(attackDamage === 0 ? [] : [1, 49, 97]);
    }
  });
}

test('a zero-damage enemy cannot shield the player from another enemy in contact', async ({ page }) => {
  await load(page, { stats: { maxHealth: 10, attackSpeed: 0 }, spawns: [], enemies: [
    { x: 202, y: 320, stats: { moveSpeed: 0, attackDamage: 0 } },
    { x: 158, y: 320, stats: { moveSpeed: 0, attackDamage: 2 } },
  ] });
  expect((await advance(page)).health).toBe(8);
  expect((await advance(page, 47)).health).toBe(8);
  const state = await advance(page);
  expect(state.health).toBe(6);
  expect(state.events.filter(e => e.type === 'damage').map(e => e.tick)).toEqual([1, 49]);
});

test('movement still uses shared stats and distant enemies never start active attacks', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0 }, spawns: [], enemies: [
    { x: 300, y: 320, stats: { moveSpeed: 120 } },
    { x: 180, y: 100, stats: { moveSpeed: 0 } },
  ] });
  const state = await advance(page, 10);
  expect(state.enemies[0].x).toBeCloseTo(280);
  expect(state.enemies[1].y).toBe(100);
  expect(state.health).toBe(3);
  expect(state.bullets).toEqual([]);
});

test('normal spawning keeps the same basic enemy and two HP for a full minute', async ({ page }) => {
  await load(page, { seed: 'basic-only', stats: { maxHealth: 1000, attackDamage: 0 } });
  const state = await advance(page, 3600);
  expect(state.enemies.length).toBeGreaterThan(0);
  expect(state.kills).toBe(0);
  for (const enemy of state.enemies) {
    expect(enemy.stats).toEqual(ENEMY_DEFINITION.stats);
    expect(enemy.health).toBe(2);
    expect(enemy.radius).toBe(10);
  }
});

test('pooled bodies reset size, health and recoil when reused', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0 },
    enemies: [{ x: 300, y: 320, health: 1, stats: { moveSpeed: 0, size: 0.75 } }],
    bullets: [{ position: { x: 300, y: 320 }, velocity: { x: 0, y: 0 } }],
    spawns: [{ tick: 2, position: { x: 300, y: 320, stats: { maxHealth: 4, size: 1.6 } } }] });
  const reused = await advance(page, 2);
  expect(reused.kills).toBe(1);
  expect(reused.enemies[0]).toMatchObject({ id: 2, health: 4, radius: 16, bodyRadius: 16, recoilUntilTick: 0 });
});
