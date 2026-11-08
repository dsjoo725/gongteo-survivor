import { expect, test, type Page } from '@playwright/test';
import type { ArenaFixture } from '../src/testing';

const tickMs = 1000 / 60;

async function load(page: Page, fixture: ArenaFixture, reducedEffects = false) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?simtest=1');
  await page.evaluate(reducedEffects => localStorage.setItem('gongteo-survivor.settings.v1', JSON.stringify({ reducedEffects })), reducedEffects);
  await page.reload();
  await page.waitForFunction(() => window.__arenaTest);
  await page.evaluate(fixture => window.__arenaTest!.configure({ progression: false, bounds: { width: 360, height: 640 }, ...fixture }), fixture);
}

async function advance(page: Page, deltaMs = tickMs) {
  return page.evaluate(deltaMs => {
    window.__arenaTest!.advanceFrame(deltaMs);
    return { state: window.__arenaTest!.snapshot(), feedback: window.__arenaTest!.feedback() };
  }, deltaMs);
}

test('a surviving enemy recoils along the incoming shot and heavier enemies move less', async ({ page }) => {
  for (const size of [0.75, 1, 1.6]) {
    await load(page, { stats: { attackSpeed: 0 }, spawns: [],
      enemies: [{ x: 300, y: 320, health: 5, stats: { size, moveSpeed: 0 } }],
      bullets: [{ position: { x: 300, y: 330 }, velocity: { x: 0, y: -420 } }] });
    const { state, feedback } = await advance(page);
    expect(state.enemies[0].x).toBe(300);
    expect(state.enemies[0].y).toBeCloseTo(320 - 3 / size);
    expect(state.enemies[0].health).toBe(4);
    expect(state.enemies[0].bodyRadius).toBeCloseTo(10 * size);
    expect(feedback.enemyHits).toHaveLength(1);
    expect(feedback.enemyDeaths).toEqual([]);
    expect((await page.evaluate(() => window.__arenaTest!.crowd())).maxBodyRenderErrorPx).toBeLessThan(1e-6);
  }
});

test('zero damage does not recoil, flash, kill or heal an enemy', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0, attackDamage: 0, lifesteal: 1 }, health: 1, spawns: [],
    enemies: [{ x: 300, y: 320, stats: { moveSpeed: 0 } }],
    bullets: [{ position: { x: 300, y: 320 }, velocity: { x: 0, y: 0 } }] });
  const { state, feedback } = await advance(page);
  expect(state.enemies[0]).toMatchObject({ x: 300, y: 320, health: 2, recoilUntilTick: 0 });
  expect(state.health).toBe(1);
  expect(feedback).toEqual({ enemyHits: [], enemyDeaths: [], playerHitActive: false });
});

test('a kill removes its collision immediately and shrinks its original appearance for only 100ms', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0, attackDamage: 10 }, spawns: [],
    enemies: [{ x: 300, y: 320, stats: { moveSpeed: 0, size: 1.6, maxHealth: 4 } }],
    bullets: [{ position: { x: 300, y: 320 }, velocity: { x: 0, y: 0 } }] });
  const killed = await advance(page);
  expect(killed.state.enemies).toEqual([]);
  expect(killed.state.kills).toBe(1);
  expect(killed.feedback.enemyHits).toEqual([]);
  expect(killed.feedback.enemyDeaths[0]).toMatchObject({ texture: 'paint-enemy', radius: 16, scale: 1.6, alpha: 1 });
  const midway = await advance(page, 50);
  expect(midway.feedback.enemyDeaths[0].scale).toBeCloseTo(0.8);
  expect(midway.feedback.enemyDeaths[0].alpha).toBe(1);
  expect((await advance(page, 50)).feedback.enemyDeaths).toEqual([]);
});

test('reduced motion changes death to a quiet fade and preserves exactly the same combat', async ({ page }) => {
  const states = [];
  for (const reduced of [false, true]) {
    await load(page, { stats: { attackSpeed: 0 }, spawns: [], enemies: [
      { x: 300, y: 320, health: 1, stats: { moveSpeed: 0, size: 0.75 } },
      { x: 100, y: 320, health: 5, stats: { moveSpeed: 0 } },
    ], bullets: [
      { position: { x: 300, y: 320 }, velocity: { x: 0, y: 0 } },
      { position: { x: 100, y: 320 }, velocity: { x: -1, y: 0 } },
    ] }, reduced);
    await advance(page);
    const midway = await advance(page, 50);
    expect(midway.feedback.enemyDeaths[0].scale).toBeCloseTo(reduced ? 0.75 : 0.375);
    expect(midway.feedback.enemyDeaths[0].alpha).toBe(reduced ? 0.5 : 1);
    states.push(midway.state);
  }
  expect(states[0]).toEqual(states[1]);
});

test('menu pause freezes recoil and death, and restart clears both', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0 }, spawns: [], enemies: [
    { x: 300, y: 320, health: 1, stats: { moveSpeed: 0, size: 0.75 } },
    { x: 100, y: 320, health: 5, stats: { moveSpeed: 95 } },
  ], bullets: [
    { position: { x: 300, y: 320 }, velocity: { x: 0, y: 0 } },
    { position: { x: 100, y: 320 }, velocity: { x: -1, y: 0 } },
  ] });
  const before = await advance(page);
  expect(before.feedback.enemyDeaths).toHaveLength(1);
  expect(before.feedback.enemyHits).toHaveLength(1);
  await page.locator('#menu-button').click();
  expect(await advance(page, 250)).toEqual(before);
  await page.locator('#resume-button').click();
  const resumed = await advance(page);
  expect(resumed.state.enemies[0].x).toBe(before.state.enemies[0].x);
  expect(resumed.feedback.enemyDeaths[0].scale).toBeLessThan(before.feedback.enemyDeaths[0].scale);
  await page.locator('#menu-button').click();
  await page.getByRole('button', { name: '다시 시작', exact: true }).click();
  await page.getByRole('button', { name: '새로 시작', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__arenaTest!.snapshot().round)).toBe(2);
  expect((await advance(page, 0)).feedback).toEqual({ enemyHits: [], enemyDeaths: [], playerHitActive: false });
});

test('recoil at a wall stays inside with mixed sizes and separates from the player', async ({ page }) => {
  await load(page, { stats: { attackSpeed: 0 }, spawns: [], enemies: [
    { x: 344, y: 320, stats: { moveSpeed: 0, size: 1.6, maxHealth: 4 } },
    { x: 325, y: 320, stats: { moveSpeed: 0, size: 0.75 } },
  ], bullets: [{ position: { x: 337, y: 320 }, velocity: { x: 420, y: 0 } }] });
  const { state } = await advance(page);
  for (const enemy of state.enemies) {
    expect(enemy.x).toBeGreaterThanOrEqual(enemy.radius - 1e-6);
    expect(enemy.x).toBeLessThanOrEqual(360 - enemy.radius + 1e-6);
    expect(Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y)).toBeGreaterThanOrEqual(enemy.radius + state.playerRadius - 1e-6);
  }
  expect((await page.evaluate(() => window.__arenaTest!.crowd())).maxPenetrationPx).toBeLessThanOrEqual(0.25);
});
