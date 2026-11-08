import { expect, test, type Page } from '@playwright/test';
import type { ArenaFixture } from '../src/testing';

const tickMs = 1000 / 60;
async function load(page: Page, fixture: ArenaFixture = {}) {
  await page.goto('/?simtest=1');
  await page.waitForFunction(() => window.__arenaTest);
  await page.evaluate(options => window.__arenaTest!.configure({ progression: true, bounds: { width: 360, height: 640 }, spawns: [], ...options }), fixture);
}
async function advance(page: Page, ticks = 1) {
  return page.evaluate(({ ticks, tickMs }) => {
    for (let i = 0; i < ticks; i++) window.__arenaTest!.advanceFrame(tickMs);
    return window.__arenaTest!.snapshot();
  }, { ticks, tickMs });
}

test('a kill grants one experience and duplicate bullets never duplicate rewards', async ({ page }) => {
  const bullet = { position: { x: 300, y: 320 }, velocity: { x: 0, y: 0 } };
  await load(page, { stats: { attackSpeed: 0 }, enemies: [{ x: 300, y: 320, health: 1, stats: { moveSpeed: 0 } }], bullets: [bullet, bullet] });
  const state = await advance(page);
  expect(state.kills).toBe(1);
  expect(state.progression).toMatchObject({ level: 1, xp: 1, totalXp: 1, pending: 0 });
  await expect(page.locator('#experience-meter')).toHaveAttribute('aria-valuenow', '1');
  await expect(page.locator('#experience-fill')).toHaveAttribute('style', 'width: 20%;');
});

test('real kills open three five-stage cards in name/image/description/stars order and freeze all combat', async ({ page }) => {
  const enemies = Array.from({ length: 5 }, (_, i) => ({ x: 40 + i * 60, y: 100, stats: { moveSpeed: 0 } }));
  await load(page, { seed: 'growth-cards', stats: { attackDamage: 2, attackSpeed: 0 }, enemies,
    bullets: enemies.map(position => ({ position, velocity: { x: 0, y: 0 } })) });
  const before = await advance(page, 4);
  expect(before.tick).toBe(1);
  expect(before.kills).toBe(5);
  expect(before.progression).toMatchObject({ level: 2, xp: 0, pending: 1 });
  await expect(page.locator('#level-up-dialog')).toBeVisible();
  const cards = page.locator('.upgrade-card');
  await expect(cards).toHaveCount(3);
  expect(new Set(before.progression.choices.map(choice => choice.id)).size).toBe(3);
  expect(await cards.first().evaluate(button => Array.from(button.children, child => child.tagName === 'STRONG' ? 'name' : child.className)))
    .toEqual(['name', 'upgrade-icon', 'upgrade-description', 'upgrade-stars']);
  await expect(cards.first().locator('.upgrade-star')).toHaveCount(5);
  await expect(cards.first().locator('.upgrade-star[data-state="next"]')).toHaveCount(1);
  await expect(cards.first().locator('.upgrade-star[data-state="empty"]')).toHaveCount(4);
  await expect(page.locator('.upgrade-value, .upgrade-select')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#level-up-dialog')).toBeVisible();
  expect(await advance(page, 20)).toEqual(before);
  await page.keyboard.press('1');
  const chosen = await advance(page, 0);
  expect(chosen.progression.pending).toBe(0);
  expect(chosen.awaitingGrowthInput).toBe(true);
  const id = before.progression.choices[0].id;
  expect(chosen.progression.ranks[id]).toBe(1);
  expect(chosen.stats[id]).not.toBe(before.stats[id]);
  expect((await advance(page, 10)).tick).toBe(1);
  await page.keyboard.down('ArrowRight');
  const resumed = await advance(page);
  expect(resumed.tick).toBe(2);
  expect(resumed.awaitingGrowthInput).toBe(false);
  expect(resumed.player.x).toBeGreaterThan(chosen.player.x);
  await page.keyboard.up('ArrowRight');
});

test('overflow creates sequential selections, double clicks and stale tokens cannot consume two rewards', async ({ page }) => {
  await load(page, { seed: 'queued-growth' });
  await page.evaluate(() => window.__arenaTest!.grantExperience(13));
  const before = await advance(page, 0);
  expect(before.progression.pending).toBe(2);
  await page.locator('.upgrade-card').first().dblclick();
  const after = await advance(page, 0);
  expect(after.progression.pending).toBe(1);
  expect(after.progression.offerId).toBeGreaterThan(before.progression.offerId);
  await page.evaluate(({ token, id }) => window.__arenaTest!.chooseUpgrade(token, id),
    { token: before.progression.offerId, id: before.progression.choices[0].id });
  expect((await advance(page, 0)).progression.pending).toBe(1);
  await page.locator('.upgrade-card').first().click();
  expect((await advance(page, 0)).awaitingGrowthInput).toBe(true);
  await page.evaluate(() => window.__arenaTest!.setPaused(true));
  await page.keyboard.press('ArrowRight');
  expect((await advance(page, 5)).tick).toBe(0);
  await page.evaluate(() => window.__arenaTest!.setPaused(false));
  await page.keyboard.down('ArrowRight');
  expect((await advance(page)).tick).toBe(1);
  await page.keyboard.up('ArrowRight');
});

test('rank five disappears from offers and completing every upgrade never traps the player in a selection', async ({ page }) => {
  await load(page, { seed: 'complete-growth' });
  const result = await page.evaluate(() => {
    const api = window.__arenaTest!;
    api.grantExperience(2540);
    let steps = 0, sawFive = false;
    while (api.snapshot().progression.pending > 0 && steps < 40) {
      const growth = api.snapshot().progression;
      const choice = growth.choices[0];
      if (choice.rank === 5) {
        const row = document.querySelector('.upgrade-stars');
        sawFive ||= row?.querySelectorAll('[data-state="owned"]').length === 4 && row.lastElementChild?.getAttribute('data-state') === 'next';
      }
      if (growth.ranks[choice.id] >= 5) throw new Error('A maxed upgrade was offered');
      api.chooseUpgrade(growth.offerId, choice.id);
      steps++;
    }
    return { steps, sawFive, state: api.snapshot() };
  });
  expect(result.steps).toBe(40);
  expect(result.sawFive).toBe(true);
  expect(result.state.progression.complete).toBe(true);
  expect(Object.values(result.state.progression.ranks)).toEqual(Array(8).fill(5));
  await expect(page.locator('#level-up-dialog')).not.toBeVisible();
  await page.keyboard.down('ArrowLeft');
  expect((await advance(page)).tick).toBe(1);
  await page.keyboard.up('ArrowLeft');
});

test('level completion fills the old bar before showing carried XP, with an instant reduced-motion path', async ({ page }) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await load(page);
    const transition = await page.evaluate(() => {
      const api = window.__arenaTest!;
      api.grantExperience(4);
      api.grantExperience(2);
      const fill = document.getElementById('experience-fill')!;
      return {
        levelText: document.getElementById('player-level')!.textContent,
        widths: (fill.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes().map(frame => frame.width),
      };
    });
    expect(transition).toEqual(reducedMotion === 'reduce'
      ? { levelText: '2', widths: undefined }
      : { levelText: '1', widths: ['80%', '100%'] });
    await expect(page.locator('#player-level')).toHaveText('2');
    await expect(page.locator('#experience-fill')).toHaveAttribute('style', 'width: 12.5%;');
    await expect(page.locator('#experience-meter')).toHaveAttribute('aria-valuenow', '1');
    await expect(page.locator('#experience-meter')).toHaveAttribute('aria-valuemax', '8');
    expect((await advance(page, 10)).tick).toBe(0);
  }
});

test('restart removes all earned experience, ranks and run-only stat modifiers', async ({ page }) => {
  await load(page, { seed: 'growth-restart' });
  await page.evaluate(() => window.__arenaTest!.grantExperience(5));
  await page.locator('.upgrade-card').first().click();
  await page.locator('#menu-button').click();
  await page.getByRole('button', { name: '다시 시작', exact: true }).click();
  await page.getByRole('button', { name: '새로 시작', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__arenaTest!.snapshot().round)).toBe(2);
  const state = await advance(page, 0);
  expect(state.progression).toMatchObject({ level: 1, xp: 0, totalXp: 0, pending: 0 });
  expect(Object.values(state.progression.ranks)).toEqual(Array(8).fill(0));
  expect(state.stats).toMatchObject({ attackDamage: 1, attackSpeed: 2.5, size: 1, maxHealth: 3 });
  expect(state.awaitingGrowthInput).toBe(false);
});

test('touch selection waits for a new battlefield drag and the HP bar follows movement and rotation', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const page = await context.newPage();
    await load(page, { seed: 'touch-growth', bounds: undefined });
    await page.evaluate(() => window.__arenaTest!.grantExperience(5));
    await page.locator('.upgrade-card').first().tap();
    const before = await advance(page, 3);
    expect(before.tick).toBe(0);
    const rect = (await page.locator('canvas').boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const x = rect.x + rect.width * 0.5, y = rect.y + rect.height * 0.7;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 65, y }] });
    const moved = await advance(page);
    expect(moved.tick).toBe(1);
    expect(moved.player.x).toBeGreaterThan(before.player.x);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    const hp = (await page.locator('#health-panel').boundingBox())!;
    expect(hp.x + hp.width / 2).toBeGreaterThan(rect.x + rect.width / 2);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => page.evaluate(() => window.__arenaTest!.view().width)).toBeGreaterThan(600);
    const bar = (await page.locator('#health-panel').boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(844);
    expect(bar.y + bar.height).toBeLessThanOrEqual(390);
  } finally { await context.close(); }
});

test('all upgrade cards share row baselines and column width across mobile offers', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await load(page, { seed: 'alignment-audit', bounds: undefined });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const audit = await page.evaluate(() => {
        const api = window.__arenaTest!;
        const ids = new Set<string>();
        const counts = new Set<number>();
        let width: number | undefined;
        const issues: string[] = [];
        api.grantExperience(2540);
        for (let step = 0; step < 40; step++) {
          const growth = api.snapshot().progression;
          if (!growth.pending) break;
          const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('.upgrade-card'));
          counts.add(cards.length);
          const boxes = cards.map(card => card.getBoundingClientRect());
          width ??= boxes[0].width;
          if (boxes.some(box => Math.abs(box.width - width!) > 0.1)) issues.push('Card width changed');
          const row = document.getElementById('upgrade-choices')!.getBoundingClientRect();
          if (Math.abs((boxes[0].left + boxes.at(-1)!.right) / 2 - row.x - row.width / 2) > 0.1) issues.push('Off-center card row');
          for (const selector of ['strong', '.upgrade-icon', '.upgrade-description', '.upgrade-stars']) {
            const tops = cards.map(card => card.querySelector(selector)!.getBoundingClientRect().top);
            if (Math.max(...tops) - Math.min(...tops) > 0.1) issues.push(`Misaligned ${selector}`);
          }
          for (const card of cards) {
            ids.add(card.dataset.upgrade!);
            const art = card.querySelector('.upgrade-painting')!.getBoundingClientRect();
            const slot = card.querySelector('.upgrade-icon')!.getBoundingClientRect();
            const description = card.querySelector('.upgrade-description')!.getBoundingClientRect();
            const stars = card.querySelector('.upgrade-stars')!.getBoundingClientRect();
            const bounds = card.getBoundingClientRect();
            const padding = parseFloat(getComputedStyle(card).paddingLeft);
            const centerError = Math.abs(art.y + art.height / 2 - slot.y - slot.height / 2);
            if (centerError > 0.1 || description.bottom > stars.top) issues.push(`Clipped or off-center ${card.dataset.upgrade}`);
            if (stars.left < bounds.left + padding - 0.1 || stars.right > bounds.right - padding + 0.1) issues.push(`Stars touch the edge of ${card.dataset.upgrade}`);
          }
          api.chooseUpgrade(growth.offerId, growth.choices[0].id);
        }
        return { ids: ids.size, counts: [...counts].sort(), issues };
      });
      expect(audit, `${viewport.width}×${viewport.height}`).toEqual({ ids: 8, counts: [1, 2, 3], issues: [] });
    }
  } finally { await context.close(); }
});
