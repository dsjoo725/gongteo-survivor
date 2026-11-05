import { expect, test, type Page } from '@playwright/test';
import type { ArenaFixture, ArenaSnapshot } from '../src/testing';

const tickMs = 1000 / 60;
const right = { x: 1, y: 0 };
const lethalContact = { x: 201, y: 320 };

async function load(page: Page, fixture: ArenaFixture, stress = false): Promise<void> {
  await page.goto(stress ? '/?simtest=1&stress=1' : '/?simtest=1');
  await page.waitForFunction(() => window.__arenaTest !== undefined);
  await page.evaluate((options) => window.__arenaTest!.configure(options), fixture);
}

function snapshot(page: Page): Promise<ArenaSnapshot> {
  return page.evaluate(() => window.__arenaTest!.snapshot());
}

async function advance(page: Page, deltaMs: number, frames = 1): Promise<ArenaSnapshot> {
  return page.evaluate(({ deltaMs, frames }) => {
    const arena = window.__arenaTest!;
    for (let frame = 0; frame < frames; frame += 1) arena.advanceFrame(deltaMs);
    return arena.snapshot();
  }, { deltaMs, frames });
}

function expectSamePosition(a: { x: number; y: number }, b: { x: number; y: number }): void {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1e-6);
}

test('the same 120 ticks produce the same movement and combat events at 30 and 60 fps', async ({ page }) => {
  const fixture = {
    seed: 'fixed-arena',
    input: Array.from({ length: 120 }, (_, index) => index < 24 ? right : { x: 0, y: 0 }),
    spawns: [{ tick: 1, position: { x: 340, y: 320 } }, { tick: 90, position: { x: 20, y: 100 } }],
    enemies: [lethalContact],
  };
  await load(page, fixture);
  const at60 = await advance(page, tickMs, 120);
  await load(page, fixture);
  const at30 = await advance(page, tickMs * 2, 60);
  expect(at60.tick).toBe(120);
  expect(at60.health).toBe(2);
  expect(at60.kills).toBeGreaterThan(0);
  expect(at60.player.x).toBeGreaterThan(180);
  for (const type of ['spawn', 'shot', 'kill', 'damage']) {
    expect(at60.events.some((event) => event.type === type)).toBe(true);
  }
  const { player, enemies, bullets, ...state } = at60;
  expect(state).toEqual({
    round: at30.round, tick: at30.tick, health: at30.health, kills: at30.kills, events: at30.events,
    stats: at30.stats, playerRadius: at30.playerRadius,
  });
  expectSamePosition(player, at30.player);
  expect(enemies.map(({ id }) => id)).toEqual(at30.enemies.map(({ id }) => id));
  expect(bullets.map(({ id }) => id)).toEqual(at30.bullets.map(({ id }) => id));
  enemies.forEach((enemy, index) => expectSamePosition(enemy, at30.enemies[index]));
  bullets.forEach((bullet, index) => expectSamePosition(bullet, at30.bullets[index]));
});

test('shot kills before a simultaneous physical contact', async ({ page }) => {
  await load(page, {
    spawns: [],
    enemies: [lethalContact],
    bullets: [{ position: { x: 186, y: 320 }, velocity: { x: 420, y: 0 } }],
  });
  const state = await advance(page, tickMs);
  expect(state.health).toBe(3);
  expect(state.kills).toBe(1);
  expect(state.events.at(-1)).toEqual({ type: 'kill', tick: 1, id: 1, bulletId: 1 });
});

test('one bullet chooses the nearest overlapping enemy, then the earlier spawn on a tie', async ({ page }) => {
  for (const [upperY, expectedId] of [[307, 1], [306.8, 2]]) {
    await load(page, {
      spawns: [],
      enemies: [{ x: 220, y: upperY }, { x: 220, y: 333 }],
      bullets: [{ position: { x: 220, y: 320 }, velocity: { x: 0, y: 0 } }],
    });
    const state = await advance(page, tickMs);
    expect(state.kills).toBe(1);
    expect(state.events).toContainEqual({ type: 'kill', tick: 1, id: expectedId, bulletId: 1 });
    expect(state.enemies.map(({ id }) => id)).toEqual([3 - expectedId]);
  }
});

test('two bullets on one enemy count one kill, and only living enemies deal contact damage', async ({ page }) => {
  const bullet = { position: { x: 186, y: 320 }, velocity: { x: 420, y: 0 } };
  await load(page, {
    spawns: [],
    enemies: [lethalContact, { x: 180, y: 341 }, { x: 160, y: 320 }],
    bullets: [bullet, bullet],
  });
  const state = await advance(page, tickMs);
  expect(state.health).toBe(2);
  expect(state.kills).toBe(1);
  expect(state.bullets.some(({ id }) => id === 2)).toBe(true);
  expect(state.events.filter(({ tick }) => tick === 1).slice(0, 2)).toEqual([
    { type: 'kill', tick: 1, id: 1, bulletId: 1 },
    { type: 'damage', tick: 1, health: 2 },
  ]);
});

test('persistent contact deals damage again exactly 48 ticks later', async ({ page }) => {
  await load(page, {
    player: { x: 180, y: 320 },
    enemies: Array.from({ length: 16 }, (_, i) => ({
      x: 180 + 22 * Math.cos(i * Math.PI / 8),
      y: 320 + 22 * Math.sin(i * Math.PI / 8),
    })),
    spawns: [],
  });
  const before = await advance(page, tickMs * 4, 12);
  expect(before.health).toBe(2);
  const after = await advance(page, tickMs);
  expect(after.events.filter(({ type }) => type === 'damage').map(({ tick }) => tick)).toEqual([1, 49]);
});

test('bullet can hit on its final tick and is recycled on expiry or offscreen', async ({ page }) => {
  await load(page, {
    player: { x: 12, y: 320 },
    spawns: [],
    enemies: [{ x: 320, y: 320 }],
    bullets: [
      { position: { x: 222, y: 320 }, velocity: { x: 0, y: 0 } },
      { position: { x: 100, y: 100 }, velocity: { x: 0, y: 0 } },
      { position: { x: 359, y: 100 }, velocity: { x: 420, y: 0 } },
    ],
  });
  expect((await advance(page, tickMs)).bullets.map(({ id }) => id)).toEqual([1, 2]);
  const before = await advance(page, tickMs * 4, 13);
  expect(before.tick).toBe(53);
  expect(before.bullets.map(({ id }) => id)).toEqual(expect.arrayContaining([1, 2]));
  expect(before.kills).toBe(0);
  const after = await advance(page, tickMs);
  expect(after.events).toContainEqual({ type: 'kill', tick: 54, id: 1, bulletId: 1 });
  expect(after.bullets.some(({ id }) => id <= 3)).toBe(false);
});

test('spawns and shots follow tick deadlines and a seed reproduces the round', async ({ page }) => {
  const fixture = { seed: 'arena-deadlines', health: 100 };
  await load(page, fixture);
  const first = await advance(page, tickMs * 4, 459);
  await load(page, fixture);
  const second = await advance(page, tickMs * 4, 459);
  expect(first).toEqual(second);
  const spawns = first.events.filter(({ type }) => type === 'spawn').map(({ tick }) => tick);
  expect(spawns[0]).toBe(48);
  expect(spawns.filter((tick) => tick >= 864 && tick <= 942)).toEqual([864, 912, 942]);
  expect(spawns.filter((tick) => tick >= 1782 && tick <= 1830)).toEqual([1782, 1812, 1830]);

  await load(page, { spawns: [], enemies: [{ x: 350, y: 320 }, { x: 10, y: 320 }] });
  const shots = (await advance(page, tickMs, 25)).events.filter(({ type }) => type === 'shot');
  expect(shots.map(({ tick }) => tick)).toEqual([1, 25]);
});

test('a full enemy pool skips a spawn deadline and the stress mode refills to 80', async ({ page }) => {
  await load(page, {
    seed: 'full-pool',
    player: { x: 180, y: 470 },
    enemies: Array.from({ length: 80 }, (_, index) => ({
      x: 10 + (index % 16) * 21, y: 10 + Math.floor(index / 16) * 20,
    })),
    input: Array.from({ length: 180 }, (_, index) => ({ x: 0, y: index < 48 ? 0 : -1 })),
    health: 100,
  });
  const full = await advance(page, tickMs * 4, 12);
  expect(full.enemies).toHaveLength(80);
  expect(full.events.some(({ tick, type }) => tick === 48 && type === 'spawn')).toBe(false);
  const after = await advance(page, tickMs * 4, 33);
  const resumedSpawns = after.events.filter(({ type, tick }) => type === 'spawn' && tick > 0);
  expect(resumedSpawns.length).toBeGreaterThan(0);
  expect(resumedSpawns.every(({ tick }) => tick % 48 === 0)).toBe(true);
  expect(after.enemies.length).toBeLessThanOrEqual(80);

  await load(page, { seed: 'stress' }, true);
  const stress = await advance(page, tickMs * 4, 100);
  expect(stress.kills).toBeGreaterThan(0);
  expect(stress.enemies).toHaveLength(80);
});

test('frame debt is capped, preserves fractions, and is cleared on pause', async ({ page }) => {
  await load(page, { spawns: [], input: Array.from({ length: 10 }, () => right) });
  expect((await advance(page, -100)).tick).toBe(0);
  await page.evaluate(() => window.__arenaTest!.advanceFrame(Number.NaN));
  expect((await advance(page, 208)).tick).toBe(4);
  expect((await advance(page, 9)).tick).toBe(5);
  expect((await advance(page, 8)).tick).toBe(5);
  await page.evaluate(() => window.__arenaTest!.setPaused(true));
  expect((await advance(page, 250)).tick).toBe(5);
  await page.evaluate(() => window.__arenaTest!.setPaused(false));
  expect((await advance(page, 9)).tick).toBe(5);
  const resumed = await advance(page, 8);
  expect(resumed.tick).toBe(6);
  expect(resumed.player.x).toBeCloseTo(198);
});

test('lethal contact halts a multi-step frame and three UI restarts reset the round once each', async ({ page }) => {
  await load(page, { health: 1, enemies: [lethalContact], spawns: [] });
  const restart = page.getByRole('button', { name: '다시 시작' });
  for (let round = 1; round <= 4; round += 1) {
    const state = await advance(page, tickMs * 4);
    expect(state.round).toBe(round);
    expect(state.health).toBe(0);
    expect(state.tick).toBe(1);
    expect(state.events).toEqual([
      { type: 'spawn', tick: 0, id: 1 },
      { type: 'damage', tick: 1, health: 0 },
    ]);
    await expect(restart).toBeVisible();
    expect((await page.evaluate(() => window.__arenaTest!.feedback())).playerFlashing).toBe(true);
    const ended = await advance(page, 120);
    expect(ended.tick).toBe(1);
    expect(ended.player).toEqual(state.player);
    expect((await page.evaluate(() => window.__arenaTest!.feedback())).playerFlashing).toBe(false);
    if (round === 4) break;
    if (round === 2) await restart.press('Enter');
    else await restart.click();
    await expect.poll(async () => (await snapshot(page)).round).toBe(round + 1);
    expect((await snapshot(page)).tick).toBe(0);
  }
});

test('the regular page runs autonomously without a test hook', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await page.locator('#kills').textContent()), { timeout: 8_000 })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__arenaTest)).toBeUndefined();
});

test('keyboard and Chromium touch input both drive the real movement adapter', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await load(page, { spawns: [] });
    await page.keyboard.down('ArrowRight');
    expect((await advance(page, tickMs)).player.x).toBeCloseTo(183);
    await page.keyboard.up('ArrowRight');
    expect((await advance(page, tickMs)).player.x).toBeCloseTo(183);

    const canvas = await page.locator('canvas').boundingBox();
    expect(canvas).not.toBeNull();
    const x = canvas!.x + canvas!.width / 2;
    const y = canvas!.y + canvas!.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x + 65, y }],
    });
    expect((await advance(page, tickMs)).player.x).toBeCloseTo(186);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect((await advance(page, tickMs)).player.x).toBeCloseTo(186);
  } finally {
    await context.close();
  }
});

test('player and enemy bodies separate while contact damage is retained', async ({ page }) => {
  await load(page, { enemies: [lethalContact], spawns: [], input: [right] });
  const state = await advance(page, tickMs);
  expect(state.enemies).toHaveLength(1);
  const enemy = state.enemies[0];
  expect(Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y)).toBeGreaterThanOrEqual(22 - 1e-6);
  expect(state.player.x).toBeCloseTo(183);
  expect(state.health).toBe(2);
});

test('exact bullet tangency counts outside player separation', async ({ page }) => {
  await load(page, {
    spawns: [],
    enemies: [{ x: 300 + 95 / 60, y: 320 }],
    bullets: [{ position: { x: 280, y: 320 }, velocity: { x: 420, y: 0 } }],
  });
  const state = await advance(page, tickMs);
  expect(state.health).toBe(3);
  expect(state.kills).toBe(1);
  expect(state.events).toContainEqual({ type: 'kill', tick: 1, id: 1, bulletId: 1 });
});

test('enemy contact cannot push the player through a wall or corner', async ({ page }) => {
  for (const [player, enemy] of [
    [{ x: 12, y: 320 }, { x: 33, y: 320 }],
    [{ x: 12, y: 12 }, { x: 26, y: 26 }],
    [{ x: 348, y: 628 }, { x: 334, y: 614 }],
  ]) {
    await load(page, { player, enemies: [enemy], spawns: [], health: 100 });
    for (let tick = 0; tick < 60; tick += 1) {
      const state = await advance(page, tickMs);
      expectSamePosition(state.player, player);
      for (const activeEnemy of state.enemies) {
        expect(Math.hypot(activeEnemy.x - state.player.x, activeEnemy.y - state.player.y))
          .toBeGreaterThanOrEqual(22 - 1e-6);
      }
    }
    expect((await snapshot(page)).events.some(({ type }) => type === 'damage')).toBe(true);
  }
});

test('a hit flashes briefly, including after a kill reuses the enemy body', async ({ page }) => {
  await load(page, {
    spawns: [{ tick: 2, position: { x: 40, y: 100 } }],
    enemies: [{ x: 300 + 95 / 60, y: 320, health: 2 }],
    bullets: [
      { position: { x: 288, y: 320 }, velocity: { x: 0, y: 0 } },
      { position: { x: 272, y: 320 }, velocity: { x: 420, y: 0 } },
    ],
  });
  expect((await advance(page, tickMs)).enemies[0].health).toBe(1);
  let visual = await page.evaluate(() => window.__arenaTest!.feedback());
  expect(visual.enemyFlashes).toEqual([{ id: 1, x: 300, y: 320, ageMs: 0 }]);
  const killed = await advance(page, tickMs);
  expect(killed.kills).toBe(1);
  expect(killed.enemies[0].id).toBe(2);
  visual = await page.evaluate(() => window.__arenaTest!.feedback());
  expect(visual.enemyFlashes).toHaveLength(1);
  expect(visual.enemyFlashes[0].id).toBe(1);
  expect(visual.enemyFlashes[0].ageMs).toBe(0);
  await advance(page, 59);
  expect((await page.evaluate(() => window.__arenaTest!.feedback())).enemyFlashes).toHaveLength(1);
  await advance(page, 1);
  expect((await page.evaluate(() => window.__arenaTest!.feedback())).enemyFlashes).toEqual([]);
});

test('only accepted player damage changes color and invulnerable contact does not extend it', async ({ page }) => {
  await load(page, { spawns: [], enemies: [{ ...lethalContact, health: 100 }] });
  expect((await advance(page, tickMs)).health).toBe(2);
  expect((await page.evaluate(() => window.__arenaTest!.feedback())).playerFlashing).toBe(true);
  await advance(page, 60);
  expect((await page.evaluate(() => window.__arenaTest!.feedback())).playerFlashing).toBe(true);
  await advance(page, 60);
  expect((await page.evaluate(() => window.__arenaTest!.feedback())).playerFlashing).toBe(false);
  expect((await snapshot(page)).health).toBe(2);
  while ((await snapshot(page)).tick < 48) await advance(page, tickMs);
  expect((await page.evaluate(() => window.__arenaTest!.feedback())).playerFlashing).toBe(false);
  expect((await advance(page, tickMs)).health).toBe(1);
  expect((await page.evaluate(() => window.__arenaTest!.feedback())).playerFlashing).toBe(true);
});

test('pause freezes flash lifetimes and restart clears them', async ({ page }) => {
  await load(page, { health: 1, enemies: [lethalContact], spawns: [] });
  await advance(page, tickMs * 4);
  await expect(page.getByRole('button', { name: '다시 시작' })).toBeVisible();
  await page.evaluate(() => window.__arenaTest!.setPaused(true));
  await advance(page, 250);
  expect((await page.evaluate(() => window.__arenaTest!.feedback())).playerFlashing).toBe(true);
  await page.evaluate(() => window.__arenaTest!.setPaused(false));
  await page.getByRole('button', { name: '다시 시작' }).click();
  await expect.poll(async () => (await snapshot(page)).round).toBe(2);
  expect(await page.evaluate(() => window.__arenaTest!.feedback())).toEqual({
    enemyFlashes: [], playerFlashing: false,
  });
});

test('the page exposes the two flashes without sound controls or horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, { seed: 'simple-stress' }, true);
  await advance(page, tickMs * 4, 100);
  expect((await snapshot(page)).enemies).toHaveLength(80);
  expect((await page.evaluate(() => window.__arenaTest!.feedback())).enemyFlashes.length)
    .toBeLessThanOrEqual(8);
  await expect(page.locator('#sound')).toHaveCount(0);
  await expect(page.locator('#sound-status')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


for (const { name, player, enemy, direction } of [
  { name: 'left', player: { x: 35, y: 320 }, enemy: { x: 10, y: 320 }, direction: { x: -1, y: 0 } },
  { name: 'right', player: { x: 325, y: 320 }, enemy: { x: 350, y: 320 }, direction: { x: 1, y: 0 } },
  { name: 'top', player: { x: 180, y: 35 }, enemy: { x: 180, y: 10 }, direction: { x: 0, y: -1 } },
  { name: 'bottom', player: { x: 180, y: 605 }, enemy: { x: 180, y: 630 }, direction: { x: 0, y: 1 } },
  { name: 'top-left', player: { x: 30, y: 30 }, enemy: { x: 10, y: 10 }, direction: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 } },
  { name: 'top-right', player: { x: 330, y: 30 }, enemy: { x: 350, y: 10 }, direction: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } },
  { name: 'bottom-left', player: { x: 30, y: 610 }, enemy: { x: 10, y: 630 }, direction: { x: -Math.SQRT1_2, y: Math.SQRT1_2 } },
  { name: 'bottom-right', player: { x: 330, y: 610 }, enemy: { x: 350, y: 630 }, direction: { x: Math.SQRT1_2, y: Math.SQRT1_2 } },
]) {
  test('pushing an enemy against the ' + name + ' boundary keeps both circles inside and separated', async ({ page }) => {
    await load(page, {
      player, enemies: [{ ...enemy, health: 100 }], health: 100, spawns: [],
      input: Array.from({ length: 180 }, () => direction),
    });
    expect(await boundaryViolations(page, 180)).toEqual([]);
    const state = await snapshot(page);
    expect(state.tick).toBe(180);
    expect(state.enemies).toHaveLength(1);
    expect(state.events.some(({ type }) => type === 'damage')).toBe(true);
  });
}

// Check every physics tick, including transient pushes that a final snapshot would miss.
async function boundaryViolations(page: Page, ticks: number): Promise<string[]> {
  return page.evaluate(({ ticks, tickMs }) => {
    const arena = window.__arenaTest!;
    for (let tick = 0; tick < ticks; tick += 1) {
      arena.advanceFrame(tickMs);
      const state = arena.snapshot();
      const violations: string[] = [];
      const check = (point: { x: number; y: number }, radius: number, label: string) => {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
          || point.x < radius - 1e-6 || point.x > 360 - radius + 1e-6
          || point.y < radius - 1e-6 || point.y > 640 - radius + 1e-6) {
          violations.push(label + ' outside at tick ' + state.tick + ': ' + JSON.stringify(point));
        }
      };
      check(state.player, 12, 'player');
      for (const enemy of state.enemies) {
        check(enemy, 10, 'enemy ' + enemy.id);
        if (Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < 22 - 1e-6) {
          violations.push('enemy ' + enemy.id + ' overlaps player at tick ' + state.tick);
        }
      }
      if (violations.length) return violations;
    }
    return [];
  }, { ticks, tickMs });
}

test('80 enemies stay bounded through crowd pressure, corners and coincident centers', async ({ page }) => {
  const input = [
    ...Array.from({ length: 180 }, () => ({ x: 1, y: 0 })),
    ...Array.from({ length: 180 }, () => ({ x: 0, y: 1 })),
    ...Array.from({ length: 180 }, () => ({ x: -1, y: 0 })),
    ...Array.from({ length: 180 }, () => ({ x: 0, y: -1 })),
  ];
  await load(page, {
    seed: 'wall-crowd', player: { x: 348, y: 12 }, input,
    enemies: Array.from({ length: 80 }, (_, index) => ({
      x: 348 - (index % 10) * 20, y: 12 + Math.floor(index / 10) * 20, health: 100,
    })),
  }, true);
  expect(await boundaryViolations(page, input.length)).toEqual([]);
  const state = await snapshot(page);
  expect(state.tick).toBe(input.length);
  expect(state.enemies).toHaveLength(80);
});


test('final crowd contact deals damage after the other enemy is killed', async ({ page }) => {
  await load(page, {
    player: { x: 328, y: 320 },
    // Both remain outside player contact after their 95/60px physical move.
    // Crowd separation pushes id1 to the player's left tangent at x306.
    enemies: [{ x: 304, y: 320 }, { x: 300, y: 320 }],
    bullets: [{ position: { x: 280, y: 320 }, velocity: { x: 420, y: 0 } }],
    spawns: [],
  });
  const state = await advance(page, tickMs);
  expect(state.kills).toBe(1);
  expect(state.enemies.map(({ id }) => id)).toEqual([1]);
  expectSamePosition(state.enemies[0], { x: 306, y: 320 });
  expect(state.health).toBe(2);
  expect(state.events.filter(({ tick }) => tick === 1).slice(0, 2)).toEqual([
    { type: 'kill', tick: 1, id: 2, bulletId: 1 },
    { type: 'damage', tick: 1, health: 2 },
  ]);
});
