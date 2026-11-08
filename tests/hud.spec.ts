import { expect, test, type Page } from '@playwright/test';
import type { ArenaFixture } from '../src/testing';

const tickMs = 1000 / 60;
async function load(page: Page, fixture: ArenaFixture = { spawns: [] }) {
  await page.goto('/?simtest=1');
  await page.waitForFunction(() => window.__arenaTest);
  await page.evaluate(options => window.__arenaTest!.configure({ progression: false, ...options }), fixture);
}
async function advance(page: Page, ticks: number) {
  return page.evaluate(({ ticks, tickMs }) => {
    for (let tick = 0; tick < ticks; tick++) window.__arenaTest!.advanceFrame(tickMs);
    return window.__arenaTest!.snapshot();
  }, { ticks, tickMs });
}

for (const viewport of [
  { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 },
  { width: 320, height: 568 },
]) {
  test(`portrait desktop arena and HUD fit ${viewport.width}x${viewport.height} without distortion`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await load(page);
    const canvas = await page.locator('canvas').boundingBox();
    const frameWidth = Math.min(viewport.width, viewport.height * 9 / 16);
    expect(canvas!.width).toBeCloseTo(frameWidth, 0);
    expect(canvas!.height).toBe(viewport.height);
    expect(canvas!.x).toBeCloseTo((viewport.width - frameWidth) / 2, 0);
    const view = await page.evaluate(() => window.__arenaTest!.view());
    expect(view.width * view.zoom).toBeCloseTo(canvas!.width, 0);
    expect(view.height * view.zoom).toBeCloseTo(viewport.height);
    const state = await advance(page, 0);
    expect(state.player.x).toBeCloseTo(view.width / 2);
    expect(state.player.y).toBeCloseTo(view.height / 2);
    expect(Math.min(view.width, view.height)).toBeGreaterThanOrEqual(360 - 1e-6);
    const health = (await page.locator('#health-panel').boundingBox())!;
    const timer = (await page.locator('.hud-record').boundingBox())!;
    const menu = (await page.locator('#menu-button').boundingBox())!;
    const xp = (await page.locator('.experience-strip').boundingBox())!;
    const kills = (await page.locator('.hud-kills').boundingBox())!;
    expect(menu.x + menu.width).toBeLessThanOrEqual(timer.x + 1);
    expect(timer.x + timer.width).toBeLessThanOrEqual(kills.x + 1);
    expect(xp.y).toBeGreaterThanOrEqual(menu.y + menu.height);
    expect(xp.width).toBeGreaterThan(frameWidth * 0.85);
    expect(health.x + health.width / 2).toBeCloseTo(canvas!.x + canvas!.width / 2, 0);
    expect(health.y).toBeGreaterThan(canvas!.y + canvas!.height / 2);
    expect(health.width).toBeLessThanOrEqual(48);
    expect(menu.width).toBeGreaterThanOrEqual(44);
    expect(menu.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight
      && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#menu-button').click();
    await page.getByRole('button', { name: '플레이어 스탯', exact: true }).click();
    const dialog = (await page.locator('#menu-dialog').boundingBox())!;
    expect(dialog.y).toBeGreaterThanOrEqual(0);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(viewport.height);
    expect(dialog.width).toBeLessThanOrEqual(frameWidth);
    await expect(page.locator('#menu-back')).toBeInViewport();
  });
}

test('menu and its subpages freeze combat, cooldowns, flashes and the survival timer together', async ({ page }) => {
  await load(page, { bounds: { width: 360, height: 640 }, health: 100,
    stats: { attackSpeed: 0 }, player: { x: 180, y: 320 },
    enemies: [{ x: 202, y: 320, health: 100 }],
    bullets: [{ position: { x: 100, y: 100 }, velocity: { x: 40, y: 0 } }], spawns: [] });
  const before = await advance(page, 1);
  const feedback = await page.evaluate(() => window.__arenaTest!.feedback());
  expect(feedback.playerHitActive).toBe(true);
  await page.locator('#menu-button').click();
  for (const name of ['플레이어 스탯', '환경설정']) {
    await page.getByRole('button', { name, exact: true }).click();
    expect(await advance(page, 120)).toEqual(before);
    expect(await page.evaluate(() => window.__arenaTest!.feedback())).toEqual(feedback);
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
  expect((await advance(page, 59)).tick).toBe(60);
  await expect(page.locator('#run-time')).toHaveText('00:01');
  await expect(page.locator('#menu-button')).toBeFocused();
});

test('dialog traps keyboard focus, returns one level on Escape, and clears held movement', async ({ page }) => {
  await load(page);
  await page.keyboard.down('ArrowRight');
  const before = await advance(page, 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#resume-button')).toBeFocused();
  for (let count = 0; count < 10; count++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('#menu-dialog')!.contains(document.activeElement))).toBe(true);
  }
  await page.getByRole('button', { name: '플레이어 스탯', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '플레이어 스탯', exact: true })).toBeFocused();
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-dialog')).not.toBeVisible();
  expect((await advance(page, 1)).player).toEqual(before.player);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowRight');
  expect((await advance(page, 1)).player.x).toBeCloseTo(before.player.x + 3);
});

test('restart needs confirmation, cancel preserves the run, and repeated rounds get fresh UI handlers', async ({ page }) => {
  await load(page);
  for (let round = 1; round <= 3; round++) {
    const before = await advance(page, 60);
    await page.locator('#menu-button').click();
    await page.getByRole('button', { name: '다시 시작', exact: true }).click();
    expect((await advance(page, 60)).round).toBe(round);
    await page.getByRole('button', { name: '취소', exact: true }).click();
    expect(await advance(page, 1)).toEqual(before);
    await page.getByRole('button', { name: '다시 시작', exact: true }).click();
    await page.getByRole('button', { name: '새로 시작', exact: true }).click();
    await expect.poll(async () => (await advance(page, 0)).round).toBe(round + 1);
    expect((await advance(page, 0)).tick).toBe(0);
    await expect(page.locator('#menu-dialog')).not.toBeVisible();
    await expect(page.locator('#menu-button')).toBeEnabled();
  }
});

test('focus return never resumes a user-opened menu and ordinary play resumes after closing it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#title-start')).toBeEnabled();
  await page.locator('#title-start').click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator('#menu-button').click();
  const time = await page.locator('#run-time').textContent();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(1100);
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await expect(page.locator('#run-time')).toHaveText(time!);
  await page.locator('#resume-button').click();
  await expect.poll(() => page.locator('#run-time').textContent()).not.toBe(time);
});

test('rotating a paused arena preserves combat state and all bodies fit the new bounds', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, { stats: { maxHealth: 100, attackSpeed: 0, size: 1.125 },
    player: { x: 348, y: 700 }, enemies: [{ x: 330, y: 700, health: 100 }],
    bullets: [{ position: { x: 100, y: 100 }, velocity: { x: 40, y: 0 } }], spawns: [] });
  const before = await advance(page, 1);
  await page.locator('#menu-button').click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await page.evaluate(() => window.__arenaTest!.view())).height).toBeCloseTo(640, 0);
  const after = await advance(page, 120);
  expect(after.tick).toBe(before.tick);
  expect(after.health).toBe(before.health);
  expect(after.events).toEqual(before.events);
  expect(after.bullets.map(b => b.id)).toEqual(before.bullets.map(b => b.id));
  const view = await page.evaluate(() => window.__arenaTest!.view());
  for (const body of [{ ...after.player, radius: after.playerRadius }, ...after.enemies]) {
    expect(body.x).toBeGreaterThanOrEqual(body.radius - 1e-6);
    expect(body.x).toBeLessThanOrEqual(view.width - body.radius + 1e-6);
    expect(body.y).toBeGreaterThanOrEqual(body.radius - 1e-6);
    expect(body.y).toBeLessThanOrEqual(view.height - body.radius + 1e-6);
  }
  for (const enemy of after.enemies) expect(Math.hypot(enemy.x - after.player.x, enemy.y - after.player.y)).toBeGreaterThanOrEqual(after.playerRadius + enemy.radius - 1e-6);
  await page.locator('#resume-button').click();
  expect((await advance(page, 1)).tick).toBe(before.tick + 1);
});

test('settings persist, invalid saved settings are safe, and unsupported fullscreen is explained', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { get: () => false });
  });
  await load(page);
  await page.evaluate(() => localStorage.setItem('gongteo-survivor.settings.v1', '{broken'));
  await load(page);
  await page.locator('#menu-button').click();
  await page.getByRole('button', { name: '환경설정', exact: true }).click();
  await expect(page.locator('#fullscreen-button')).toBeDisabled();
  await expect(page.locator('#fullscreen-button')).toHaveText('지원 안 됨');
  await page.getByLabel('피격 효과 줄이기', { exact: false }).check();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gongteo-survivor.settings.v1')!))).toEqual({ reducedEffects: true });
  await load(page);
  await page.locator('#menu-button').click();
  await page.getByRole('button', { name: '환경설정', exact: true }).click();
  await expect(page.locator('#reduced-effects')).toBeChecked();
});

test('fullscreen request rejection keeps the game paused and reports a usable fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { get: () => true });
    Element.prototype.requestFullscreen = () => Promise.reject(new Error('blocked'));
  });
  await load(page);
  await page.locator('#menu-button').click();
  await page.getByRole('button', { name: '환경설정', exact: true }).click();
  await page.locator('#fullscreen-button').click();
  await expect(page.locator('#settings-status')).toContainText('현재 화면에서 계속 플레이');
  expect((await advance(page, 60)).tick).toBe(0);
});

test('menu cancels an active touch drag; a fresh drag after resume uses the resized camera coordinates', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  try {
    const page = await context.newPage();
    await load(page);
    const cdp = await context.newCDPSession(page);
    const origin = { x: 300, y: 240 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [origin] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: origin.x + 70, y: origin.y }] });
    const moving = await advance(page, 1);
    const view = await page.evaluate(() => window.__arenaTest!.view());
    expect(moving.player.x).toBeCloseTo(view.width / 2 + 3);
    await page.locator('#menu-button').click();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.locator('#resume-button').click();
    expect((await advance(page, 1)).player).toEqual(moving.player);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [origin] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: origin.x + 70, y: origin.y }] });
    expect((await advance(page, 1)).player.x).toBeCloseTo(moving.player.x + 3);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  } finally { await context.close(); }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`touch viewport fills ${viewport.width}x${viewport.height} and 80 enemies stay inside adaptive bounds`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: true });
    try {
      const page = await context.newPage();
      await page.goto('/?simtest=1&stress=1');
      await page.waitForFunction(() => window.__arenaTest);
      await page.evaluate(() => window.__arenaTest!.configure({ progression: false, seed: 'responsive-crowd', stats: { maxHealth: 100 },
        input: Array.from({ length: 300 }, () => ({ x: -Math.SQRT1_2, y: -Math.SQRT1_2 })) }));
      expect(await page.locator('canvas').boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
      const audit = await page.evaluate(tickMs => {
        const test = window.__arenaTest!;
        const view = test.view();
        const errors: string[] = [];
        for (let tick = 0; tick < 300; tick++) {
          test.advanceFrame(tickMs);
          const state = test.snapshot();
          for (const actor of [{ ...state.player, radius: state.playerRadius }, ...state.enemies]) {
            if (actor.x < actor.radius - 1e-6 || actor.y < actor.radius - 1e-6
              || actor.x > view.width - actor.radius + 1e-6 || actor.y > view.height - actor.radius + 1e-6) errors.push('body outside');
          }
          if (test.crowd().maxPenetrationPx > 1) errors.push('crowd overlap');
          for (const enemy of state.enemies) if (Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < state.playerRadius + enemy.radius - 1e-6) errors.push('player overlap');
          if (errors.length) break;
        }
        return { errors, count: test.snapshot().enemies.length, tick: test.snapshot().tick };
      }, tickMs);
      expect(audit.errors).toEqual([]);
      expect(audit.count).toBe(80);
      expect(audit.tick).toBe(300);
    } finally { await context.close(); }
  });
}
