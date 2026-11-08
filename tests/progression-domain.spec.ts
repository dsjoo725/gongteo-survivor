import { expect, test } from '@playwright/test';
import { CombatActor } from '../src/combat';
import { createPlayerStats } from '../src/stats';
import { Progression, availableUpgrades, levelXpCost, MAX_UPGRADE_RANK, UPGRADE_IDS } from '../src/progression';

const actor = () => new CombatActor({ kind: 'player', id: 0 }, createPlayerStats(), 12);

test('experience carries overflow through multiple levels and rewards each kill only once', () => {
  const growth = new Progression(true, () => 0.5);
  growth.awardKill(1); growth.awardKill(1);
  expect(growth.xp).toBe(1);
  growth.gain(12);
  expect(growth.snapshot()).toMatchObject({ level: 3, xp: 0, totalXp: 13, nextXp: 11, pending: 2 });
  growth.gain(2);
  expect(growth.xp).toBe(2);
  for (const amount of [-1, 1.5, NaN, Infinity]) expect(() => growth.gain(amount)).toThrow();
});

test('three distinct valid offers are stable until selection and deterministic for a seed stream', () => {
  const offers = [];
  for (let run = 0; run < 2; run++) {
    const growth = new Progression(true, () => 0.4);
    growth.gain(5);
    const choices = growth.offer(availableUpgrades(actor(), growth.ranks, 0));
    expect(choices).toHaveLength(3);
    expect(new Set(choices.map(choice => choice.id)).size).toBe(3);
    expect(growth.offer([])).toBe(choices);
    offers.push(choices);
  }
  expect(offers[0]).toEqual(offers[1]);
});

test('selection is transactional and stale tokens cannot spend the next reward', () => {
  const player = actor();
  const growth = new Progression(true, () => 0);
  growth.gain(13);
  const choices = growth.offer(availableUpgrades(player, growth.ranks, 0));
  const token = growth.offerId;
  expect(() => growth.choose(token, choices[0].id, () => { throw new Error('Rejected'); })).toThrow();
  expect(growth.pending).toBe(2);
  expect(growth.ranks.attackDamage).toBe(0);
  expect(growth.choose(token, choices[0].id, choice => player.statBlock.upsert(choice.effect, 0))).toBe(true);
  growth.offer(availableUpgrades(player, growth.ranks, 0));
  expect(growth.choose(token, choices[0].id, () => { throw new Error('Must not apply'); })).toBe(false);
  expect(growth.pending).toBe(1);
});

test('all eight upgrades stop at five stages and fully upgraded runs continue without more choices', () => {
  const player = actor();
  const growth = new Progression(true, () => 0);
  growth.gain(Array.from({ length: 40 }, (_, i) => levelXpCost(i + 1)).reduce((sum, value) => sum + value, 0));
  for (const id of UPGRADE_IDS) {
    for (let rank = 1; rank <= MAX_UPGRADE_RANK; rank++) {
      const choice = availableUpgrades(player, growth.ranks, 0).find(option => option.id === id)!;
      expect(choice.rank).toBe(rank);
      growth.offer([choice]);
      growth.choose(growth.offerId, id, choice => player.statBlock.upsert(choice.effect, 0));
    }
    expect(availableUpgrades(player, growth.ranks, 0).some(choice => choice.id === id)).toBe(false);
  }
  expect(growth.complete).toBe(true);
  expect(growth.pending).toBe(0);
  expect(Object.values(growth.ranks)).toEqual(Array(8).fill(5));
  expect(player.stats.attackDamage).toBe(3.5);
  expect(player.stats.attackSpeed).toBe(5);
  expect(player.stats.maxHealth).toBe(8);
  expect(player.stats.size).toBeCloseTo(0.9 ** 5);
  const level = growth.level;
  growth.gain(1000);
  expect(growth.level).toBe(level);
  expect(growth.offer([])).toEqual([]);
});

test('probability saturation never creates invalid offers and a fresh run resets every rank', () => {
  const player = new CombatActor({ kind: 'player', id: 0 }, createPlayerStats({ critChance: 1, lifesteal: 1 }), 12);
  const growth = new Progression(true, () => 0);
  const choices = availableUpgrades(player, growth.ranks, 0);
  expect(choices.map(choice => choice.id)).not.toContain('critChance');
  expect(choices.map(choice => choice.id)).not.toContain('lifesteal');
  expect(choices).toHaveLength(6);
  expect(new Progression(true, () => 0).snapshot()).toMatchObject({ level: 1, xp: 0, pending: 0, complete: false });
});
