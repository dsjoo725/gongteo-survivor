import type { Point } from './rules';

// Relative motion detects a moving circle crossing a moving target, including
// grazing contacts and small targets between physics samples. Returns 0..1.
export function sweptCircleTime(from: Point, to: Point, targetFrom: Point, targetTo: Point, radius: number): number | undefined {
  const x = from.x - targetFrom.x, y = from.y - targetFrom.y;
  const dx = to.x - from.x - (targetTo.x - targetFrom.x);
  const dy = to.y - from.y - (targetTo.y - targetFrom.y);
  const c = x * x + y * y - radius * radius;
  const epsilon = 1e-9;
  if (c <= epsilon) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return undefined;
  const b = 2 * (x * dx + y * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -epsilon) return undefined;
  const root = Math.sqrt(Math.max(0, discriminant));
  // Stable quadratic roots avoid cancellation for long, fast trajectories.
  const q = -0.5 * (b + (b < 0 ? -root : root));
  const roots = q === 0 ? [-b / (2 * a)] : [q / a, c / q];
  const time = Math.min(...roots.filter(value => value >= -epsilon && value <= 1 + epsilon));
  return Number.isFinite(time) ? Math.max(0, Math.min(1, time)) : undefined;
}
