import { expect, test } from '@playwright/test';
import { solveCrowd } from '../src/crowd';
import { spawnPoint } from '../src/rules';

test('solver result is independent of input order and reports final projected penetration', () => {
  const source = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, x: 350, y: 320 }));
  const forward = source.map(body => ({ ...body }));
  const backward = source.map(body => ({ ...body })).reverse();
  const player = { x: 328, y: 320 };
  const first = solveCrowd(player, forward);
  expect(solveCrowd(player, backward)).toEqual(first);
  expect(backward).toEqual(forward);
  let residual = 0;
  for (let a = 0; a < forward.length; a++) {
    expect(forward[a].x).toBeGreaterThanOrEqual(10);
    expect(forward[a].x).toBeLessThanOrEqual(350);
    expect(forward[a].y).toBeGreaterThanOrEqual(10);
    expect(forward[a].y).toBeLessThanOrEqual(630);
    expect(Math.hypot(forward[a].x - player.x, forward[a].y - player.y)).toBeGreaterThanOrEqual(22 - 1e-6);
    for (let b = a + 1; b < forward.length; b++) {
      residual = Math.max(residual, 20 - Math.hypot(forward[a].x - forward[b].x, forward[a].y - forward[b].y));
    }
  }
  expect(first.maxPenetrationPx).toBeCloseTo(residual, 10);
  expect(first.passes).toBeLessThanOrEqual(16);
  if (first.passes < 16) expect(residual).toBeLessThanOrEqual(0.25);
});

test('spawn admission uses one 16-candidate budget for player clearance and enemy spacing', () => {
  for (const fixture of [
    { player: { x: 12, y: 12 }, enemies: [] },
    { player: { x: 180, y: 320 }, enemies: [{ x: 10, y: 10 }] },
  ]) {
    let draws = 0;
    expect(spawnPoint(fixture.player, () => { draws++; return 0; }, fixture.enemies)).toBeUndefined();
    expect(draws).toBe(16);
  }
  let draws = 0;
  const candidates = [0, 0.25];
  const point = spawnPoint({ x: 180, y: 320 }, () => candidates[draws++], [{ x: 10, y: 10 }]);
  expect(draws).toBe(2);
  expect(point).toBeDefined();
  expect(Math.hypot(point!.x - 10, point!.y - 10)).toBeGreaterThanOrEqual(20);
  expect(Math.hypot(point!.x - 180, point!.y - 320)).toBeGreaterThanOrEqual(120);
});
