import { expect, test, type Page } from '@playwright/test';

async function load(page: Page, title = false) {
  await page.goto(`/?simtest=1${title ? '&title=1' : ''}`);
  await page.waitForFunction(() => window.__arenaTest);
  await page.evaluate(() => window.__arenaTest!.configure({ spawns: [], enemies: [], progression: true, stats: { attackSpeed: 0 } }));
}
async function advance(page: Page, ticks = 1) {
  return page.evaluate(ticks => {
    for (let i = 0; i < ticks; i++) window.__arenaTest!.advanceFrame(1000 / 60);
    return { state: window.__arenaTest!.snapshot(), art: window.__arenaTest!.presentation() };
  }, ticks);
}

test('title freezes the run and repeated start input enters exactly one live run', async ({ page }) => {
  await load(page, true);
  await expect(page.locator('#title-screen')).toBeVisible();
  expect((await advance(page, 120)).state).toMatchObject({ tick: 0, kills: 0, progression: { xp: 0 } });
  await page.evaluate(() => { const button = document.getElementById('title-start') as HTMLButtonElement; button.click(); button.click(); });
  const active = await advance(page);
  expect(active.art.phase).toBe('playing');
  expect(active.state).toMatchObject({ round: 1, tick: 1 });
  await expect(page.locator('#title-screen')).toBeHidden();
  await page.reload();
  await expect(page.locator('#title-start')).toBeEnabled();
  await expect(page.locator('#title-screen')).toBeVisible();
});

test('title settings share persisted settings and close back to title without starting combat', async ({ page }) => {
  await load(page, true);
  await page.locator('#title-settings').click();
  await page.locator('#reduced-effects').check();
  await page.locator('#menu-back').click();
  await expect(page.locator('#menu-dialog')).not.toBeVisible();
  await expect(page.locator('#title-settings')).toBeFocused();
  expect((await advance(page, 60)).state.tick).toBe(0);
  await page.locator('#title-settings').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#title-screen')).toBeVisible();
  await page.locator('#title-start').click();
  await page.locator('#menu-button').click();
  await page.getByRole('button', { name: '환경설정', exact: true }).click();
  await expect(page.locator('#reduced-effects')).toBeChecked();
});

test('failed art keeps start disabled and retry recovers without duplicate canvases', async ({ page }) => {
  await page.route('**/art/moonlight/player.png', route => route.abort());
  await page.goto('/?simtest=1&title=1');
  await expect(page.locator('#art-retry')).toBeVisible();
  await expect(page.locator('#title-start')).toBeDisabled();
  expect(await page.evaluate(() => window.__arenaTest)).toBeUndefined();
  await page.unroute('**/art/moonlight/player.png');
  await page.locator('#art-retry').click();
  await expect(page.locator('#title-start')).toBeEnabled();
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('#art-status')).toBeEmpty();
});

test('blocked local fonts use fallback and settings storage failures remain usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/fonts/**', route => route.abort());
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Storage blocked'); }; });
  await load(page, true);
  await page.locator('#title-settings').click();
  await page.locator('#reduced-effects').check();
  await expect(page.locator('#settings-status')).toContainText('이번 게임에 적용');
  await page.keyboard.press('Escape');
  await page.locator('#title-start').click();
  expect((await advance(page)).state.tick).toBe(1);
  expect(errors).toEqual([]);
});

test('art follows existing bodies, freezes its pose and scales without changing collision rules', async ({ page }) => {
  await load(page);
  await page.keyboard.down('ArrowRight');
  const moving = await advance(page, 3);
  await page.keyboard.up('ArrowRight');
  const player = moving.art.actors.find(actor => actor.kind === 'player')!;
  expect(player.texture).toBe('paint-player');
  expect(player.height).toBeCloseTo(36);
  expect(player.x).toBeCloseTo(moving.state.player.x);
  expect(Math.abs(player.angle)).toBeLessThanOrEqual(2);
  expect(Math.abs(player.y - moving.state.player.y)).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.__arenaTest!.setPaused(true));
  expect((await advance(page, 60)).art).toEqual(moving.art);
  await page.evaluate(() => window.__arenaTest!.setBaseStats({ kind: 'player', id: 0 }, { size: 1.125 }));
  const sized = await advance(page, 0);
  expect(sized.art.actors[0].height).toBeCloseTo(40.5);
  expect(sized.state.playerRadius).toBe(13.5);
});

test('reduced movement art preserves the same simulation and no sprites leak across restarts', async ({ page }) => {
  const states = [];
  for (const reduced of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await load(page);
    await page.keyboard.down('ArrowLeft');
    const moved = await advance(page, 6);
    await page.keyboard.up('ArrowLeft');
    states.push(moved.state);
    expect(moved.art.actors[0].flipX).toBe(true);
    if (reduced) expect(moved.art.actors[0].angle).toBe(0);
    const objects = moved.art.objects;
    for (let round = 2; round <= 6; round++) {
      await page.locator('#menu-button').click();
      await page.getByRole('button', { name: '다시 시작', exact: true }).click();
      await page.getByRole('button', { name: '새로 시작', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__arenaTest!.snapshot().round)).toBe(round);
      const fresh = await advance(page, 0);
      expect(fresh.art.actors).toHaveLength(1);
      expect(fresh.art.objects).toBe(objects);
      expect(fresh.art.phase).toBe('playing');
    }
  }
  expect(states[0]).toEqual(states[1]);
});

test('normal entry starts real-time combat from the title', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#title-start')).toBeEnabled();
  await expect(page.locator('#run-time')).toHaveText('00:00');
  await page.locator('#title-start').click();
  await expect(page.locator('#run-time')).not.toHaveText('00:00');
  await page.locator('#menu-button').click();
  await expect(page.locator('#menu-dialog')).toBeVisible();
});

test('simulated safe areas keep HUD targets and upgrade content inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-top', '44px');
    document.documentElement.style.setProperty('--safe-bottom', '34px');
    window.__arenaTest!.grantExperience(5);
  });
  const pause = (await page.locator('#menu-button').boundingBox())!;
  expect(pause.y).toBeGreaterThanOrEqual(44);
  expect(pause.width).toBe(48);
  expect(pause.height).toBe(48);
  const dialog = (await page.locator('#level-up-dialog').boundingBox())!;
  expect(dialog.y).toBeGreaterThanOrEqual(44);
  expect(dialog.y + dialog.height).toBeLessThanOrEqual(844 - 34);
  for (const card of await page.locator('.upgrade-card').all()) {
    await expect(card).toBeInViewport();
    await expect(card.locator('.upgrade-description')).toBeVisible();
    await expect(card.locator('.upgrade-stars')).toBeVisible();
  }
});
