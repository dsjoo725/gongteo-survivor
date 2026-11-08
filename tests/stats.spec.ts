import { expect, test, type Page } from '@playwright/test';
import { RunState, spawnPoint } from '../src/rules';
import { createPlayerStats, DEFAULT_PLAYER_STATS, formatStat, playerRadius, shotIntervalTicks } from '../src/stats';
import type { ArenaFixture } from '../src/testing';

const tickMs = 1000 / 60;

async function load(page: Page, fixture: ArenaFixture = {}): Promise<void> {
  await page.goto('/?simtest=1');
  await page.waitForFunction(() => window.__arenaTest !== undefined);
  await page.evaluate(options => window.__arenaTest!.configure({ progression: false, bounds: { width: 360, height: 640 }, ...options }), fixture);
}

async function advance(page: Page, ticks = 1) {
  return page.evaluate(({ ticks, tickMs }) => {
    for (let index = 0; index < ticks; index++) window.__arenaTest!.advanceFrame(tickMs);
    return window.__arenaTest!.snapshot();
  }, { ticks, tickMs });
}

const hit = { position: { x: 300, y: 320 }, velocity: { x: 0, y: 0 } };

test('defaults preserve the original balance and copies cannot change other runs', () => {
  const custom = createPlayerStats({ attackDamage: 4 });
  expect(custom.attackDamage).toBe(4);
  expect(Object.isFrozen(custom)).toBe(true);
  const stats = createPlayerStats();
  expect(stats).toEqual({ attackDamage: 1, attackSpeed: 2.5, critChance: 0, critMultiplier: 2,
    maxHealth: 3, moveSpeed: 180, size: 1, lifesteal: 0 });
  expect(stats).not.toBe(DEFAULT_PLAYER_STATS);
  expect(shotIntervalTicks(stats)).toBe(24);
  expect(playerRadius(stats)).toBe(12);
});

test('invalid, nonfinite and oversized stats are rejected and valid boundaries work', () => {
  for (const key of Object.keys(DEFAULT_PLAYER_STATS)) {
    for (const value of [NaN, Infinity, -Infinity, -1, undefined, null, '1']) {
      expect(() => createPlayerStats({ [key]: value })).toThrow();
    }
  }
  for (const overrides of [
    { maxHealth: 0 }, { size: 0 }, { size: 16 }, { critChance: 1.01 },
    { lifesteal: 1.01 }, { critMultiplier: 0.99 }, { attackDamage: Number.MAX_VALUE, critMultiplier: 2 },
  ]) expect(() => createPlayerStats(overrides)).toThrow();
  expect(() => createPlayerStats({ attackDamage: 0, attackSpeed: 0, moveSpeed: 0,
    critChance: 1, critMultiplier: 1, lifesteal: 1, size: 15 })).not.toThrow();
  expect(shotIntervalTicks(createPlayerStats({ attackSpeed: 0 }))).toBe(Infinity);
  expect(shotIntervalTicks(createPlayerStats({ attackSpeed: 7 }))).toBeCloseTo(60 / 7);
  expect(shotIntervalTicks(createPlayerStats({ attackSpeed: 1000 }))).toBeCloseTo(0.06);
  expect(formatStat(0.001)).toBe('<0.01');
});

test('fractional contact damage reaches zero and healing never revives or exceeds max health', () => {
  const run = new RunState(3);
  run.health = 2.9;
  run.heal(1);
  expect(run.health).toBe(3);
  run.health = 0.5;
  expect(run.takeContactDamage()).toBe(true);
  expect(run.health).toBe(0);
  run.heal(3);
  expect(run.health).toBe(0);
  expect(run.takeContactDamage()).toBe(false);
  run.health = 100; // Existing fixtures may deliberately bypass the max HP.
  run.heal(1);
  expect(run.health).toBe(100);
});

test('large-player spawn clearance rejects body overlap beyond the old 120px clearance', () => {
  let draws = 0;
  expect(spawnPoint({ x: 160, y: 160 }, () => { draws++; return 150 / 1920; }, [], 160)).toBeUndefined();
  expect(draws).toBe(16);
});

test('defaults apply to movement, shooting and the visible HUD', async ({ page }) => {
  await load(page, { enemies: [{ x: 350, y: 320, health: 100 }], spawns: [],
    input: [{ x: 1, y: 0 }] });
  const first = await advance(page);
  expect(first.player.x).toBeCloseTo(183);
  expect(first.stats).toEqual(DEFAULT_PLAYER_STATS);
  expect(first.playerRadius).toBe(12);
  const state = await advance(page, 24);
  expect(state.events.filter(event => event.type === 'shot').map(event => event.tick)).toEqual([1, 25]);
  await expect(page.locator('#health')).toHaveText('3 / 3');
});

for (const critChance of [0, 1]) {
  test(`attack damage applies with critical chance ${critChance}`, async ({ page }) => {
    await load(page, { stats: { attackDamage: 2, attackSpeed: 0, critChance, critMultiplier: 3 },
      enemies: [{ x: 300, y: 320, health: 10 }], bullets: [hit], spawns: [] });
    const state = await advance(page);
    expect(state.enemies[0].health).toBe(critChance === 0 ? 8 : 4);
    expect(state.kills).toBe(0);
  });
}

test('zero damage neither kills nor heals', async ({ page }) => {
  await load(page, { stats: { attackDamage: 0, attackSpeed: 0, critChance: 1, lifesteal: 1 },
    health: 1, enemies: [{ x: 300, y: 320, health: 10 }], bullets: [hit], spawns: [] });
  const state = await advance(page);
  expect(state.enemies[0].health).toBe(10);
  expect(state.health).toBe(1);
  expect(state.kills).toBe(0);
});

test('lifesteal uses actual HP removed, keeps fractions and updates HUD after a nonlethal hit', async ({ page }) => {
  await load(page, { stats: { attackDamage: 0.5, attackSpeed: 0, lifesteal: 0.5 },
    health: 1, enemies: [{ x: 300, y: 320, health: 10 }], bullets: [hit], spawns: [] });
  const state = await advance(page);
  expect(state.health).toBe(1.25);
  expect(state.enemies[0].health).toBe(9.5);
  await expect(page.locator('#health')).toHaveText('1.25 / 3');
});

test('critical overkill heals only the remaining enemy health', async ({ page }) => {
  await load(page, { stats: { attackDamage: 5, attackSpeed: 0, critChance: 1, lifesteal: 0.5 },
    health: 1, enemies: [{ x: 300, y: 320, health: 0.75 }], bullets: [hit], spawns: [] });
  const state = await advance(page);
  expect(state.health).toBe(1.375);
  expect(state.kills).toBe(1);
  expect(state.enemies).toHaveLength(0);
});

test('lifesteal includes critical damage and caps healing at max HP', async ({ page }) => {
  await load(page, { stats: { attackDamage: 1, attackSpeed: 0, critChance: 1, critMultiplier: 3, lifesteal: 0.5 },
    health: 1, enemies: [{ x: 300, y: 320, health: 20 }], bullets: [hit, hit, hit], spawns: [] });
  const state = await advance(page);
  expect(state.health).toBe(3);
  expect(state.enemies[0].health).toBe(11);
});

test('a nonlethal bullet heals and its recoil prevents contact until the enemy closes in again', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0, lifesteal: 0.5 }, health: 0.75,
    enemies: [{ x: 201, y: 320, health: 10 }],
    bullets: [{ position: { x: 193, y: 320 }, velocity: { x: 0, y: 0 } }], spawns: [] });
  const state = await advance(page);
  expect(state.health).toBe(1.25);
  expect(state.enemies[0].health).toBe(9);
  await expect(page.locator('#results')).toBeHidden();
  const contacted = await advance(page, 8);
  expect(contacted.health).toBe(0.25);
});

test('zero attack speed stops firing and zero move speed stops movement', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0, moveSpeed: 0 }, spawns: [],
    enemies: [{ x: 350, y: 320, health: 100 }],
    input: Array.from({ length: 60 }, () => ({ x: 1, y: 0 })) });
  const state = await advance(page, 60);
  expect(state.player).toEqual({ x: 180, y: 320 });
  expect(state.events.some(event => event.type === 'shot')).toBe(false);
});

test('high attack speed preserves logical attacks while sharing at most one visual packet per tick', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 1000, attackDamage: 0, maxHealth: 100 },
    player: { x: 12, y: 12 }, enemies: [{ x: 180, y: 180, health: 100 }], spawns: [] });
  const first = await advance(page, 12);
  expect(first.bullets.length).toBeGreaterThan(8);
  const state = await advance(page, 108);
  expect(state.events.filter(event => event.type === 'shot').map(event => event.tick))
    .toEqual(Array.from({ length: 120 }, (_, index) => index + 1));
  expect(state.combatEvents.filter(event => event.type === 'attack' && event.attack.kind === 'projectile')
    .reduce((sum, event) => sum + (event.type === 'attack' ? event.attack.count : 0), 0)).toBe(2000);
  expect(state.bullets.length).toBeLessThanOrEqual(55);
});

for (const size of [0.5, 1.125, 2, 15]) {
  test(`size ${size} keeps exact collision/render centers through movement and crowd pressure`, async ({ page }) => {
    const radius = 12 * size;
    await load(page, { stats: { size, attackSpeed: 0, moveSpeed: 240, maxHealth: 100 },
      player: { x: radius, y: radius }, spawns: [],
      enemies: Array.from({ length: 8 }, () => ({ x: radius + radius + 10, y: radius, health: 100 })),
      input: Array.from({ length: 90 }, () => ({ x: -Math.SQRT1_2, y: -Math.SQRT1_2 })) });
    const errors = await page.evaluate(({ radius, tickMs }) => {
      const arena = window.__arenaTest!;
      const errors: string[] = [];
      for (let index = 0; index < 90; index++) {
        arena.advanceFrame(tickMs);
        const state = arena.snapshot();
        if (state.playerRadius !== radius) errors.push('wrong body radius');
        if (state.player.x < radius - 1e-6 || state.player.y < radius - 1e-6
          || state.player.x > 360 - radius + 1e-6 || state.player.y > 640 - radius + 1e-6) errors.push('player outside');
        if (arena.crowd().maxBodyRenderErrorPx > 1e-6) errors.push('render/body mismatch');
        for (const enemy of state.enemies) {
          if (Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < radius + 10 - 1e-6) errors.push('overlap');
          if (enemy.x < 10 - 1e-6 || enemy.x > 350 + 1e-6 || enemy.y < 10 - 1e-6 || enemy.y > 630 + 1e-6) errors.push('enemy outside');
        }
        if (errors.length) break;
      }
      return errors;
    }, { radius, tickMs });
    expect(errors).toEqual([]);
    const state = await advance(page);
    expect(state.health).toBeLessThan(100);
  });
}

test('custom movement speed and fractional max HP apply at the beginning of a run', async ({ page }) => {
  await load(page, { stats: { moveSpeed: 240, maxHealth: 4.5 }, spawns: [], input: [{ x: 1, y: 0 }] });
  const state = await advance(page);
  expect(state.player.x).toBeCloseTo(184);
  expect(state.health).toBe(4.5);
  await expect(page.locator('#health')).toHaveText('4.5 / 4.5');
});

test('seeded critical damage reproduces at 30 and 60 FPS', async ({ page }) => {
  const states = [];
  for (const fps of [30, 60]) {
    await load(page, { seed: 'stats-critical', stats: { critChance: 0.5, attackSpeed: 6, maxHealth: 100 },
      enemies: [{ x: 300, y: 320, health: 100 }], bullets: Array.from({ length: 20 }, () => hit), spawns: [] });
    states.push(await page.evaluate(fps => {
      for (let frame = 0; frame < fps * 2; frame++) window.__arenaTest!.advanceFrame(1000 / fps);
      return window.__arenaTest!.snapshot();
    }, fps));
  }
  expect(states[0]).toEqual(states[1]);
  expect(states[0].enemies[0].health).toBeLessThan(80);
  expect(states[0].enemies[0].health).toBeGreaterThan(0);
});

test('critical rolls do not consume spawn randomness', async ({ page }) => {
  const states = [];
  for (const critChance of [0, 0.5]) {
    await load(page, { seed: 'separate-streams', stats: { attackDamage: 0, attackSpeed: 6, critChance, maxHealth: 100 } });
    // Critical attack metadata may differ; spawning and resulting world state must not.
    const { stats, combatEvents, ...state } = await advance(page, 600);
    states.push(state);
  }
  expect(states[0]).toEqual(states[1]);
});

test('restart restores custom stats and full HP without leaking state between rounds', async ({ page }) => {
  await load(page, { stats: { maxHealth: 0.5, size: 1.125, attackSpeed: 0, moveSpeed: 240 },
    player: { x: 180, y: 320 }, enemies: [{ x: 202, y: 320, health: 10 }], spawns: [] });
  for (let round = 1; round <= 3; round++) {
    const ended = await advance(page, 4);
    expect(ended.round).toBe(round);
    expect(ended.tick).toBe(1);
    expect(ended.health).toBe(0);
    await page.getByRole('button', { name: '다시 시작' }).click();
    await expect.poll(() => page.evaluate(() => window.__arenaTest!.snapshot().round)).toBe(round + 1);
    const fresh = await page.evaluate(() => window.__arenaTest!.snapshot());
    expect(fresh.tick).toBe(0);
    expect(fresh.health).toBe(0.5);
    expect(fresh.stats).toEqual(ended.stats);
    expect(fresh.playerRadius).toBe(13.5);
    expect(fresh.kills).toBe(0);
  }
});

test('invalid test configuration can be corrected before starting the run', async ({ page }) => {
  await page.goto('/?simtest=1');
  await page.waitForFunction(() => window.__arenaTest !== undefined);
  const rejected = await page.evaluate(() => {
    try { window.__arenaTest!.configure({ stats: { size: 20 } }); return false; }
    catch { return true; }
  });
  expect(rejected).toBe(true);
  await page.evaluate(() => window.__arenaTest!.configure({ stats: { maxHealth: 5 }, spawns: [] }));
  expect((await advance(page)).health).toBe(5);
});

test('all eight stats are keyboard accessible inside a paused menu on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, { stats: { attackDamage: 2, attackSpeed: 3, critChance: 0.25, critMultiplier: 2.5,
    maxHealth: 5, moveSpeed: 200, size: 1.125, lifesteal: 0.1 }, spawns: [] });
  const panel = page.locator('.player-stats');
  await expect(panel).toBeHidden();
  await page.locator('#menu-button').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '플레이어 스탯', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await expect(panel.locator('dd')).toHaveText(['2', '3회/초', '25%', '250%', '5', '200px/초', '1.13배', '10%']);
  expect((await advance(page, 10)).tick).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Escape');
  expect((await advance(page, 10)).tick).toBe(10);
  await expect(panel.locator('input')).toHaveCount(0);
});
