import { expect, test, type Page } from '@playwright/test';
import type { ArenaFixture } from '../src/testing';

const tickMs = 1000 / 60;
const playerRef = { kind: 'player' as const, id: 0 };

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

for (const { label, size, y, velocity } of [
  { label: 'grazing the default enemy', size: 1, y: 332.9, velocity: 420 },
  { label: 'crossing a tiny enemy', size: 0.01, y: 320, velocity: 420 },
  { label: 'crossing a target at high speed', size: 1, y: 320, velocity: 12_000 },
]) {
  test(`swept projectile hits while ${label}`, async ({ page }) => {
    await load(page, { stats: { attackSpeed: 0 }, spawns: [],
      enemies: [{ x: 300, y: 320, stats: { moveSpeed: 0, size } }],
      bullets: [{ position: { x: velocity === 420 ? 296.5 : 200, y }, velocity: { x: velocity, y: 0 } }] });
    const state = await advance(page);
    expect(state.enemies[0].health).toBe(1);
    expect(state.bullets).toEqual([]);
    expect(state.combatEvents.filter(event => event.type === 'hit')).toHaveLength(1);
  });
}

test('swept collision chooses the first target along the path rather than the nearest endpoint', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0 }, spawns: [],
    enemies: [{ x: 300, y: 320, stats: { moveSpeed: 0 } }, { x: 250, y: 320, stats: { moveSpeed: 0 } }],
    bullets: [{ position: { x: 200, y: 320 }, velocity: { x: 12_000, y: 0 } }] });
  const state = await advance(page);
  expect(state.enemies.map(enemy => enemy.health)).toEqual([2, 1]);
});

for (const [speed, count] of [[60, 120], [120, 240], [1000, 2000]]) {
  test(`live attack speed ${speed} produces ${count} attacks in two seconds`, async ({ page }) => {
    await load(page, { stats: { attackSpeed: speed, attackDamage: 0, maxHealth: 100 }, spawns: [],
      enemies: [{ x: 300, y: 320, health: 100, stats: { moveSpeed: 0 } }] });
    const state = await advance(page, 120);
    const attacks = state.combatEvents.flatMap(event => event.type === 'attack' && event.attack.kind === 'projectile' ? [event.attack] : []);
    expect(attacks.reduce((sum, attack) => sum + attack.count, 0)).toBe(count);
    expect(attacks).toHaveLength(120);
    expect(state.bullets.length).toBeLessThanOrEqual(55);
  });
}

test('unused attacks in a packet keep travelling and kill another target without duplicate kill events', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 120 }, spawns: [], enemies: [
    { x: 240, y: 320, health: 1, stats: { moveSpeed: 0 } },
    { x: 280, y: 320, health: 1, stats: { moveSpeed: 0 } },
  ] });
  await advance(page);
  await page.evaluate(ref => window.__arenaTest!.setBaseStats(ref, { attackSpeed: 0 }), playerRef);
  const state = await advance(page, 20);
  expect(state.kills).toBe(2);
  expect(state.enemies).toEqual([]);
  expect(state.events.filter(event => event.type === 'shot')).toHaveLength(1);
  expect(state.combatEvents.filter(event => event.type === 'kill')).toHaveLength(2);
  expect(state.combatEvents.filter(event => event.type === 'hit').map(event => event.type === 'hit' ? event.hits : 0)).toEqual([1, 1]);
});

test('in-flight damage, crit and lifesteal remain fixed while new shots use updated stats', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0, lifesteal: 0.5 }, health: 1, spawns: [],
    enemies: [{ x: 300, y: 320, health: 100, stats: { moveSpeed: 0 } }],
    bullets: [{ position: { x: 300, y: 320 }, velocity: { x: 0, y: 0 } }] });
  await page.evaluate(ref => window.__arenaTest!.setBaseStats(ref, {
    attackDamage: 10, attackSpeed: 60, critChance: 1, critMultiplier: 3, lifesteal: 1,
  }), playerRef);
  const state = await advance(page);
  expect(state.enemies[0].health).toBe(99);
  expect(state.health).toBe(1.5);
  expect(state.bullets[0].attack).toMatchObject({ damage: 30, critical: true, lifesteal: 1 });
});

test('live modifiers update health bounds, geometry, movement, attack rate and the stats HUD together', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0 }, health: 1.25, player: { x: 12, y: 12 }, spawns: [],
    enemies: [{ x: 50, y: 12, health: 100, stats: { moveSpeed: 0 } }] });
  await page.evaluate(ref => window.__arenaTest!.upsertModifier(ref, { id: 'growth',
    add: { maxHealth: 2, size: 0.5, moveSpeed: 60, attackSpeed: 4 }, expiresAtTick: 5 }), playerRef);
  const grown = await advance(page, 0);
  expect(grown.health).toBe(1.25);
  expect(grown.stats).toMatchObject({ maxHealth: 5, moveSpeed: 240, attackSpeed: 4, size: 1.5 });
  expect(grown.playerRadius).toBe(18);
  expect(grown.player).toEqual({ x: 18, y: 18 });
  await expect(page.locator('[data-stat="maxHealth"]')).toHaveText('5');
  await expect(page.locator('#health')).toHaveText('1.25 / 5');
  await advance(page, 4);
  await page.evaluate(() => window.__arenaTest!.setPaused(true));
  await page.evaluate(ref => window.__arenaTest!.setBaseStats(ref, { attackDamage: 2 }), playerRef);
  await expect(page.locator('[data-stat="attackDamage"]')).toHaveText('2');
  const paused = await advance(page, 30);
  expect(paused.tick).toBe(4);
  expect(paused.stats.attackDamage).toBe(2);
  expect(paused.stats.size).toBe(1.5);
  await page.evaluate(() => window.__arenaTest!.setPaused(false));
  const expired = await advance(page);
  expect(expired.stats).toMatchObject({ maxHealth: 3, size: 1, moveSpeed: 180, attackSpeed: 0 });
  expect(expired.playerRadius).toBe(12);
  expect(expired.health).toBe(1.25);
});

test('enemy stat updates affect its collider and contact damage immediately', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0, maxHealth: 10 }, spawns: [],
    enemies: [{ x: 202, y: 320, stats: { moveSpeed: 0 } }] });
  await page.evaluate(() => window.__arenaTest!.setBaseStats({ kind: 'enemy', id: 1 }, { attackDamage: 2, size: 2, maxHealth: 4 }));
  const state = await advance(page);
  expect(state.enemies[0]).toMatchObject({ radius: 20, bodyRadius: 20, health: 2 });
  expect(state.health).toBe(8);
  expect(Math.hypot(state.enemies[0].x - state.player.x, state.enemies[0].y - state.player.y)).toBeGreaterThanOrEqual(32 - 1e-6);
  expect((await page.evaluate(() => window.__arenaTest!.crowd())).maxBodyRenderErrorPx).toBeLessThan(1e-6);
});

test('an on-kill extension heals on the next combat tick, respects pause, and is cleared by restart', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0 }, health: 1, spawns: [],
    enemies: [{ x: 300, y: 320, health: 1, stats: { moveSpeed: 0 } }],
    bullets: [{ position: { x: 300, y: 320 }, velocity: { x: 0, y: 0 } }] });
  await page.evaluate(() => window.__arenaTest!.onCombatEvent(event => {
    if (event.type === 'kill') window.__arenaTest!.enqueue({ type: 'heal', source: event.attack.source,
      target: event.attack.source, amount: 0.5 });
  }));
  expect((await advance(page)).health).toBe(1);
  await page.evaluate(() => window.__arenaTest!.setPaused(true));
  expect((await advance(page, 30)).health).toBe(1);
  await page.evaluate(() => window.__arenaTest!.setPaused(false));
  expect((await advance(page)).health).toBe(1.5);
  await page.locator('#menu-button').click();
  await page.getByRole('button', { name: '다시 시작', exact: true }).click();
  await page.getByRole('button', { name: '새로 시작', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__arenaTest!.snapshot().round)).toBe(2);
  expect((await advance(page, 2)).health).toBe(1);
});
