import { COMBAT, constrainEnemyPosition, distanceSquared, type Point } from './rules';

export interface CrowdBody extends Point { id: number }
export interface CrowdResult { passes: number; maxPenetrationPx: number }

const MAX_PASSES = 16;
const STOP_PENETRATION_PX = 0.25;
const RELAXATION = 1.5;
const DIAMETER = COMBAT.enemyRadius * 2;

function project(body: CrowdBody, player: Point, playerRadius: number): void {
  const position = constrainEnemyPosition(body, player, playerRadius);
  body.x = position.x;
  body.y = position.y;
}

function separate(a: CrowdBody, b: CrowdBody, player: Point, playerRadius: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const squared = dx * dx + dy * dy;
  if (squared >= DIAMETER ** 2) return;
  const distance = Math.sqrt(squared);
  let nx: number;
  let ny: number;
  if (distance < 1e-4) {
    // A cardinal direction can be entirely cancelled by a tangent wall/player.
    // ID-based diagonals escape coincident centers without consuming spawn RNG.
    const pair = Math.imul(a.id, 73856093) ^ Math.imul(b.id, 19349663);
    nx = (pair & 1 ? 1 : -1) * Math.SQRT1_2;
    ny = (pair & 2 ? 1 : -1) * Math.SQRT1_2;
  } else {
    nx = dx / distance;
    ny = dy / distance;
  }
  const correction = (DIAMETER - distance) * RELAXATION;
  // Let the outer enemy absorb more pressure, toward available space instead of
  // repeatedly compressing the inner enemy against the player. Equal radii split.
  const radialA = distanceSquared(a, player);
  const radialB = distanceSquared(b, player);
  const shareA = Math.abs(radialA - radialB) < 1e-6 ? 0.5 : radialA > radialB ? 0.75 : 0.25;
  const correctionA = correction * shareA;
  const correctionB = correction * (1 - shareA);
  const oldAX = a.x, oldAY = a.y, oldBX = b.x, oldBY = b.y;
  a.x -= nx * correctionA;
  a.y -= ny * correctionA;
  b.x += nx * correctionB;
  b.y += ny * correctionB;
  project(a, player, playerRadius);
  project(b, player, playerRadius);
  // A hard boundary can cancel one side of the correction. Transfer that lost
  // normal movement to the other body once, using the same pre-transfer result.
  const gainedA = Math.max(0, Math.min(correctionA, (oldAX - a.x) * nx + (oldAY - a.y) * ny));
  const gainedB = Math.max(0, Math.min(correctionB, (b.x - oldBX) * nx + (b.y - oldBY) * ny));
  const lostA = correctionA - gainedA;
  const lostB = correctionB - gainedB;
  if (lostA > 1e-9) {
    b.x += nx * lostA;
    b.y += ny * lostA;
    project(b, player, playerRadius);
  }
  if (lostB > 1e-9) {
    a.x -= nx * lostB;
    a.y -= ny * lostB;
    project(a, player, playerRadius);
  }
}

function maxPenetration(enemies: CrowdBody[]): number {
  let max = 0;
  for (let a = 0; a < enemies.length; a++) for (let b = a + 1; b < enemies.length; b++) {
    const squared = distanceSquared(enemies[a], enemies[b]);
    if (squared < DIAMETER ** 2) max = Math.max(max, DIAMETER - Math.sqrt(squared));
  }
  return max;
}

// Mutates only this tick's position copies. Phaser sync and damage belong to the scene.
export function solveCrowd(player: Point, enemies: CrowdBody[], playerRadius = COMBAT.playerRadius): CrowdResult {
  enemies.sort((a, b) => a.id - b.id);
  for (const enemy of enemies) project(enemy, player, playerRadius);
  let residual = maxPenetration(enemies);
  let passes = 0;
  while (passes < MAX_PASSES && residual > STOP_PENETRATION_PX) {
    if (passes % 2 === 0) {
      for (let a = 0; a < enemies.length - 1; a++) for (let b = a + 1; b < enemies.length; b++) {
        separate(enemies[a], enemies[b], player, playerRadius);
      }
    } else {
      for (let a = enemies.length - 2; a >= 0; a--) for (let b = enemies.length - 1; b > a; b--) {
        separate(enemies[a], enemies[b], player, playerRadius);
      }
    }
    passes++;
    // Measure after all hard projections: the last pair can recreate an earlier overlap.
    residual = maxPenetration(enemies);
  }
  return { passes, maxPenetrationPx: residual };
}
