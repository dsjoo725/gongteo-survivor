import { expect, test, type Page } from '@playwright/test';
import type { ArenaFixture } from '../src/testing';

const tickMs = 1000 / 60;
async function load(page: Page, fixture: ArenaFixture, stress = false): Promise<void> {
  await page.goto('/?simtest=1' + (stress ? '&stress=1' : ''));
  await page.waitForFunction(() => window.__arenaTest !== undefined);
  await page.evaluate(options => window.__arenaTest!.configure({ progression: false, bounds: { width: 360, height: 640 }, ...options }), fixture);
}

async function audit(page: Page, ticks: number, recoveryTicks = 0, stress = false) {
  return page.evaluate(({ ticks, recoveryTicks, tickMs, stress }) => {
    const arena = window.__arenaTest!;
    let maxDepthPx = 0;
    let maxPasses = 0;
    let ticksBelow80 = 0;
    const solveTimesMs: number[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      arena.advanceFrame(tickMs);
      const state = arena.snapshot();
      const errors: string[] = [];
      const crowd = arena.crowd();
      maxPasses = Math.max(maxPasses, crowd.passes);
      if (tick > 120) solveTimesMs.push(crowd.elapsedMs);
      if (crowd.passes > 16 || (crowd.passes < 16 && crowd.maxPenetrationPx > 0.25 + 1e-6)) errors.push('solver budget/early exit');
      if (crowd.maxBodyRenderErrorPx > 1e-6) errors.push('body/render mismatch');
      ticksBelow80 = state.enemies.length === 80 ? 0 : ticksBelow80 + 1;
      if (stress && (state.enemies.length > 80 || ticksBelow80 > 120)) errors.push('stress population did not refill within 120 ticks');
      const bounded = (point: { x: number; y: number }, radius: number, name: string) => {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
          || point.x < radius - 1e-6 || point.x > 360 - radius + 1e-6
          || point.y < radius - 1e-6 || point.y > 640 - radius + 1e-6) errors.push(name + ' outside');
      };
      bounded(state.player, 12, 'player');
      for (const enemy of state.enemies) {
        bounded(enemy, enemy.radius, 'enemy ' + enemy.id);
        if (Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < state.playerRadius + enemy.radius - 1e-6) errors.push('player overlap');
      }
      for (let a = 0; a < state.enemies.length; a++) for (let b = a + 1; b < state.enemies.length; b++) {
        const first = state.enemies[a], second = state.enemies[b];
        const depthPx = Math.max(0, first.radius + second.radius - Math.hypot(first.x - second.x, first.y - second.y));
        if (tick >= recoveryTicks) {
          maxDepthPx = Math.max(maxDepthPx, depthPx);
          if (depthPx > 1) errors.push('pair ' + first.id + '/' + second.id + ' overlap ' + depthPx.toFixed(4) + 'px');
        }
      }
      if (errors.length) return { errors, tick: state.tick, maxDepthPx };
    }
    solveTimesMs.sort((a, b) => a - b);
    return { errors: [], tick: arena.snapshot().tick, maxDepthPx, maxPasses,
      p95SolveMs: solveTimesMs[Math.ceil(solveTimesMs.length * 0.95) - 1] ?? 0 };
  }, { ticks, recoveryTicks, tickMs, stress });
}

for (const { name, player, enemy } of [
  { name: 'right', player: { x: 328, y: 320 }, enemy: { x: 350, y: 320 } },
  { name: 'left', player: { x: 32, y: 320 }, enemy: { x: 10, y: 320 } },
  { name: 'top', player: { x: 180, y: 32 }, enemy: { x: 180, y: 10 } },
  { name: 'bottom', player: { x: 180, y: 608 }, enemy: { x: 180, y: 630 } },
]) {
  test('coincident enemies recover at the ' + name + ' wall tangent and stay separated', async ({ page }) => {
    await load(page, { player, health: 100, spawns: [], enemies: [
      { ...enemy, health: 100 }, { ...enemy, health: 100 },
    ] });
    const result = await audit(page, 180, 30);
    expect(result.errors, JSON.stringify(result)).toEqual([]);
    expect(result.tick).toBe(180);
    expect((await page.evaluate(() => window.__arenaTest!.snapshot())).enemies).toHaveLength(2);
  });
}


for (const { name, player, enemy } of [
  { name: 'top-left', player: { x: 12, y: 12 }, enemy: { x: 34, y: 12 } },
  { name: 'top-right', player: { x: 348, y: 12 }, enemy: { x: 326, y: 12 } },
  { name: 'bottom-left', player: { x: 12, y: 628 }, enemy: { x: 34, y: 628 } },
  { name: 'bottom-right', player: { x: 348, y: 628 }, enemy: { x: 326, y: 628 } },
  { name: 'center', player: { x: 180, y: 320 }, enemy: { x: 202, y: 320 } },
]) {
  test('eight coincident enemies recover near ' + name, async ({ page }) => {
    await load(page, { player, health: 100, spawns: [],
      enemies: Array.from({ length: 8 }, () => ({ ...enemy, health: 100 })),
    });
    const result = await audit(page, 180, 30);
    expect(result.errors, JSON.stringify(result)).toEqual([]);
    expect((await page.evaluate(() => window.__arenaTest!.snapshot())).enemies).toHaveLength(8);
  });
}

test('a dense row recovers while the player pushes it toward a wall', async ({ page }) => {
  await load(page, { player: { x: 280, y: 320 }, health: 100, spawns: [],
    input: Array.from({ length: 180 }, () => ({ x: 1, y: 0 })),
    enemies: Array.from({ length: 8 }, (_, i) => ({ x: 305 + i * 6, y: 320, health: 100 })),
  });
  const result = await audit(page, 180, 30);
  expect(result.errors, JSON.stringify(result)).toEqual([]);
});

const locations = [
  { name: 'center', player: { x: 180, y: 320 }, direction: { x: 0, y: 0 } },
  { name: 'left', player: { x: 12, y: 320 }, direction: { x: -1, y: 0 } },
  { name: 'right', player: { x: 348, y: 320 }, direction: { x: 1, y: 0 } },
  { name: 'top', player: { x: 180, y: 12 }, direction: { x: 0, y: -1 } },
  { name: 'bottom', player: { x: 180, y: 628 }, direction: { x: 0, y: 1 } },
  { name: 'top-left', player: { x: 12, y: 12 }, direction: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 } },
  { name: 'top-right', player: { x: 348, y: 12 }, direction: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } },
  { name: 'bottom-left', player: { x: 12, y: 628 }, direction: { x: -Math.SQRT1_2, y: Math.SQRT1_2 } },
  { name: 'bottom-right', player: { x: 348, y: 628 }, direction: { x: Math.SQRT1_2, y: Math.SQRT1_2 } },
];
for (const seed of ['overlap-audit', 'crowd-b', 'crowd-c']) for (const { name, player, direction } of locations) {
  test('80 enemies retain spacing for 30 seconds at ' + name + ' seed ' + seed, async ({ page }) => {
    await load(page, { seed, player, input: Array.from({ length: 1800 }, () => direction) }, true);
    const result = await audit(page, 1800, 0, true);
    expect(result.errors, JSON.stringify(result)).toEqual([]);
    expect(result.tick).toBe(1800);
    console.log(JSON.stringify({ location: name, seed, ...result }));
  });
}

for (const seed of ['overlap-audit', 'crowd-b', 'crowd-c']) {
  test('80 enemies retain spacing through moving wall and corner pressure seed ' + seed, async ({ page }) => {
    const directions = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
    await load(page, { seed, input: Array.from({ length: 1800 }, (_, i) => directions[Math.floor(i / 180) % 4]) }, true);
    const result = await audit(page, 1800, 0, true);
    expect(result.errors, JSON.stringify(result)).toEqual([]);
    expect(result.tick).toBe(1800);
    console.log(JSON.stringify({ location: 'moving', seed, ...result }));
  });
}


test('the same crowded 120 ticks reproduce positions and events at 30 and 60 fps', async ({ page }) => {
  const fixture = { seed: 'crowd-fixed-clock', input: Array.from({ length: 120 }, (_, i) => ({ x: i < 60 ? 1 : 0, y: i < 60 ? 0 : 1 })) };
  const snapshots = [];
  for (const fps of [60, 30]) {
    await load(page, fixture, true);
    snapshots.push(await page.evaluate(fps => {
      const arena = window.__arenaTest!;
      for (let frame = 0; frame < fps * 2; frame++) arena.advanceFrame(1000 / fps);
      return arena.snapshot();
    }, fps));
  }
  expect(snapshots[0].tick).toBe(120);
  expect(snapshots[0]).toEqual(snapshots[1]);
});
