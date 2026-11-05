export const ARENA = { width: 360, height: 640 };

export const COMBAT = {
  playerRadius: 12,
  playerSpeed: 180,
  enemyRadius: 10,
  enemySpeed: 95,
  enemyLimit: 80,
  spawnClearance: 120,
  shotRange: 240,
  shotIntervalTicks: 24,
  bulletRadius: 3,
  bulletSpeed: 420,
  bulletLifetimeTicks: 54,
  maxHealth: 3,
  damageCooldownTicks: 48,
};

export interface Point {
  x: number;
  y: number;
}

export function distanceSquared(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

// Centers must leave room for the whole circle, not just stay on the screen.
export function clampToArena(point: Point, radius: number): Point {
  return {
    x: Math.max(radius, Math.min(ARENA.width - radius, point.x)),
    y: Math.max(radius, Math.min(ARENA.height - radius, point.y)),
  };
}

// A wall clamp alone can put an enemy back inside the player. Find the closest
// legal point on the contact circle, including where that circle meets a wall.
export function constrainEnemyPosition(point: Point, player: Point, playerRadius = COMBAT.playerRadius): Point {
  const clamped = clampToArena(point, COMBAT.enemyRadius);
  const radius = playerRadius + COMBAT.enemyRadius;
  const distance = Math.hypot(clamped.x - player.x, clamped.y - player.y);
  if (distance >= radius) return clamped;

  const left = COMBAT.enemyRadius;
  const right = ARENA.width - left;
  const top = COMBAT.enemyRadius;
  const bottom = ARENA.height - top;
  const candidates: Point[] = [];
  if (distance > 0) {
    const radial = {
      x: player.x + (clamped.x - player.x) * radius / distance,
      y: player.y + (clamped.y - player.y) * radius / distance,
    };
    // The radial point is already closest if it fits inside the arena.
    if (radial.x >= left && radial.x <= right && radial.y >= top && radial.y <= bottom) return radial;
  }
  // Cardinal points also give a deterministic escape from coincident centers.
  candidates.push(
    { x: player.x + radius, y: player.y }, { x: player.x - radius, y: player.y },
    { x: player.x, y: player.y + radius }, { x: player.x, y: player.y - radius },
  );
  for (const x of [left, right]) {
    const remainder = radius ** 2 - (x - player.x) ** 2;
    if (remainder < 0) continue;
    const offset = Math.sqrt(remainder);
    candidates.push({ x, y: player.y + offset }, { x, y: player.y - offset });
  }
  for (const y of [top, bottom]) {
    const remainder = radius ** 2 - (y - player.y) ** 2;
    if (remainder < 0) continue;
    const offset = Math.sqrt(remainder);
    candidates.push({ x: player.x + offset, y }, { x: player.x - offset, y });
  }

  let best: Point | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate.x < left || candidate.x > right || candidate.y < top || candidate.y > bottom) continue;
    const candidateDistance = distanceSquared(candidate, clamped);
    if (candidateDistance >= bestDistance) continue;
    best = candidate;
    bestDistance = candidateDistance;
  }
  // With this arena and a bounded player, at least one cardinal point fits.
  return best!;
}

export function nearestTarget<T extends Point & { active: boolean }>(
  origin: Point,
  candidates: Iterable<T>,
): T | undefined {
  let best: T | undefined;
  let bestDistance = COMBAT.shotRange ** 2;
  for (const candidate of candidates) {
    if (!candidate.active) continue;
    const distance = distanceSquared(origin, candidate);
    if (distance > bestDistance || (best && distance === bestDistance)) continue;
    best = candidate;
    bestDistance = distance;
  }
  return best;
}

export function spawnIntervalTicks(tick: number): number {
  if (tick < 900) return 48;
  if (tick < 1_800) return 30;
  return 18;
}

export function spawnPoint(
  player: Point, random = Math.random, enemies: Iterable<Point> = [],
  playerRadius = COMBAT.playerRadius,
): Point | undefined {
  const left = COMBAT.enemyRadius;
  const top = COMBAT.enemyRadius;
  const right = ARENA.width - left;
  const bottom = ARENA.height - top;
  const width = right - left;
  const height = bottom - top;
  const perimeter = 2 * (width + height);

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const offset = random() * perimeter;
    let point: Point;
    if (offset < width) {
      point = { x: left + offset, y: top };
    } else if (offset < width + height) {
      point = { x: right, y: top + offset - width };
    } else if (offset < 2 * width + height) {
      point = { x: right - (offset - width - height), y: bottom };
    } else {
      point = { x: left, y: bottom - (offset - 2 * width - height) };
    }
    const clearance = Math.max(COMBAT.spawnClearance, playerRadius + COMBAT.enemyRadius);
    if (distanceSquared(point, player) < clearance ** 2) continue;
    let clear = true;
    for (const enemy of enemies) {
      if (distanceSquared(point, enemy) < (COMBAT.enemyRadius * 2) ** 2) {
        clear = false;
        break;
      }
    }
    if (clear) return point;
  }

  return undefined;
}

export class RunState {
  health: number;
  kills = 0;
  tick = 0;
  protectedUntilTick = 0;

  constructor(readonly maxHealth = COMBAT.maxHealth) {
    this.health = maxHealth;
  }

  heal(amount: number): void {
    if (this.health <= 0 || this.health >= this.maxHealth) return;
    this.health += Math.min(Math.max(0, amount), this.maxHealth - this.health);
  }

  takeContactDamage(): boolean {
    if (this.health === 0 || this.tick < this.protectedUntilTick) return false;
    this.health = Math.max(0, this.health - 1);
    this.protectedUntilTick = this.tick + COMBAT.damageCooldownTicks;
    return true;
  }
}
